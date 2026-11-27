// src/crypto/vault.ts
// Envelope encryption vault:
// - Ephemeral boot: non-extractable RAM-only 256-bit AES-GCM DEK when no passphrase is set
// - Passphrase mode: 6+ char passphrase / 6-digit PIN -> PBKDF2 (600,000 iterations, SHA-256) -> KEK
// - Random 256-bit AES-GCM Data Encryption Key (DEK) wrapped by KEK at rest
// - Non-extractable DEK held strictly in RAM while unlocked
// - Multi-tab BroadcastChannel + db.onversionchange + QuotaExceededError handling

import { isQuotaExceededError } from '../db/storageGuard';

const VAULT_META_DB = 'BhashaSetuVaultMeta';
const VAULT_META_STORE = 'meta';
const ENCOUNTER_DB_NAME = 'BhashaSetuEdgeDB';
const VAULT_CANARY = 'BHASHASETU_ENVELOPE_V4';
const IDLE_LOCK_MS = 5 * 60 * 1000; // 5 minutes
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 6;

export interface CipherBlob {
  iv: string;
  ciphertext: string;
}

export interface UnlockResult {
  ok: boolean;
  failedAttempts: number;
  lockoutRemainingMs: number;
}

let ramDek: CryptoKey | null = null;
let isEphemeralSession = false;
let idleLockTimer: number | null = null;

function broadcastVaultEvent(type: 'VAULT_LOCKED' | 'VAULT_WIPED'): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('bhashasetu-state');
      bc.postMessage({ type });
      bc.close();
    }
  } catch {
    // Ignore unsupported BroadcastChannel
  }
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is required; insecure fallback is disabled.');
  }
  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function openVaultMetaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = globalThis.indexedDB.open(VAULT_META_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULT_META_STORE)) {
        db.createObjectStore(VAULT_META_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getVaultMeta<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openVaultMetaDB();
    const res = await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(VAULT_META_STORE, 'readonly');
      const req = tx.objectStore(VAULT_META_STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return undefined;
  }
}

async function setVaultMeta(key: string, value: unknown): Promise<void> {
  const db = await openVaultMetaDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VAULT_META_STORE, 'readwrite');
      tx.objectStore(VAULT_META_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new Error('VAULT_QUOTA_EXCEEDED');
    }
    throw err;
  } finally {
    db.close();
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.indexedDB === 'undefined') {
      resolve();
      return;
    }
    const req = globalThis.indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function deriveKekFromPassphrase(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

function lockoutDurationForAttempts(attempts: number): number {
  if (attempts >= 8) return 120 * 1000;
  if (attempts >= 5) return 30 * 1000;
  return 0;
}

export const VaultCrypto = {
  async isInitialized(): Promise<boolean> {
    const wrappedDek = await getVaultMeta<string>('wrapped_dek_b64');
    return Boolean(wrappedDek);
  },

  isUnlocked(): boolean {
    return ramDek !== null;
  },

  isEphemeral(): boolean {
    return isEphemeralSession && ramDek !== null;
  },

  async unlockEphemeralSession(): Promise<void> {
    const subtle = getSubtle();
    ramDek = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    isEphemeralSession = true;
  },

  lock(silent = false): void {
    ramDek = null;
    isEphemeralSession = false;
    if (idleLockTimer !== null) {
      globalThis.clearTimeout(idleLockTimer);
      idleLockTimer = null;
    }
    if (!silent) {
      broadcastVaultEvent('VAULT_LOCKED');
    }
  },

  touchSession(onAutoLock: () => void): void {
    if (!this.isUnlocked() || isEphemeralSession) return;
    if (idleLockTimer !== null) globalThis.clearTimeout(idleLockTimer);
    idleLockTimer = globalThis.setTimeout(() => {
      this.lock();
      onAutoLock();
    }, IDLE_LOCK_MS) as unknown as number;
  },

  async getThrottleState(): Promise<{ failedAttempts: number; lockoutRemainingMs: number }> {
    const failedAttempts = (await getVaultMeta<number>('failed_attempts')) ?? 0;
    const lockoutUntil = (await getVaultMeta<number>('lockout_until')) ?? 0;
    const remaining = Math.max(0, lockoutUntil - Date.now());
    return { failedAttempts, lockoutRemainingMs: remaining };
  },

  async exportWrappedMetadata(): Promise<Record<string, unknown> | null> {
    const salt_b64 = await getVaultMeta<string>('salt_b64');
    const wrap_iv_b64 = await getVaultMeta<string>('wrap_iv_b64');
    const wrapped_dek_b64 = await getVaultMeta<string>('wrapped_dek_b64');
    const canary = await getVaultMeta<CipherBlob>('canary');
    if (!salt_b64 || !wrap_iv_b64 || !wrapped_dek_b64 || !canary) return null;
    return {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt_b64,
      wrap_iv_b64,
      wrapped_dek_b64,
      canary,
    };
  },

  async encryptWithKey(key: CryptoKey, payload: unknown): Promise<CipherBlob> {
    const subtle = getSubtle();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    };
  },

  async decryptWithKey<T>(key: CryptoKey, blob: CipherBlob): Promise<T> {
    const subtle = getSubtle();
    const iv = base64ToBytes(blob.iv);
    const data = base64ToBytes(blob.ciphertext);
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
  },

  async setupPassphrase(passphrase: string): Promise<void> {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const subtle = getSubtle();
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const wrapIv = globalThis.crypto.getRandomValues(new Uint8Array(12));

    const initialDek = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const kek = await deriveKekFromPassphrase(passphrase, salt);
    const wrappedBuf = await subtle.wrapKey('raw', initialDek, kek, {
      name: 'AES-GCM',
      iv: wrapIv,
    });

    const nonExtractableDek = await subtle.unwrapKey(
      'raw',
      wrappedBuf,
      kek,
      { name: 'AES-GCM', iv: wrapIv },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const canary = await this.encryptWithKey(nonExtractableDek, { check: VAULT_CANARY });
    ramDek = nonExtractableDek;
    isEphemeralSession = false;

    await setVaultMeta('salt_b64', bytesToBase64(salt));
    await setVaultMeta('wrap_iv_b64', bytesToBase64(wrapIv));
    await setVaultMeta('wrapped_dek_b64', bytesToBase64(new Uint8Array(wrappedBuf)));
    await setVaultMeta('canary', canary);
    await setVaultMeta('failed_attempts', 0);
    await setVaultMeta('lockout_until', 0);
  },

  async unlockWithPassphrase(passphrase: string): Promise<UnlockResult> {
    const throttle = await this.getThrottleState();
    if (throttle.lockoutRemainingMs > 0) {
      return {
        ok: false,
        failedAttempts: throttle.failedAttempts,
        lockoutRemainingMs: throttle.lockoutRemainingMs,
      };
    }

    const saltB64 = await getVaultMeta<string>('salt_b64');
    const wrapIvB64 = await getVaultMeta<string>('wrap_iv_b64');
    const wrappedDekB64 = await getVaultMeta<string>('wrapped_dek_b64');
    const canary = await getVaultMeta<CipherBlob>('canary');

    if (!saltB64 || !wrapIvB64 || !wrappedDekB64 || !canary) {
      return { ok: false, failedAttempts: 0, lockoutRemainingMs: 0 };
    }

    let matched = false;
    try {
      const subtle = getSubtle();
      const kek = await deriveKekFromPassphrase(passphrase, base64ToBytes(saltB64));
      const candidateDek = await subtle.unwrapKey(
        'raw',
        base64ToBytes(wrappedDekB64),
        kek,
        { name: 'AES-GCM', iv: base64ToBytes(wrapIvB64) },
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const decoded = await this.decryptWithKey<{ check: string }>(candidateDek, canary);
      if (decoded.check === VAULT_CANARY) {
        ramDek = candidateDek;
        isEphemeralSession = false;
        matched = true;
      }
    } catch {
      matched = false;
    }

    if (matched) {
      await setVaultMeta('failed_attempts', 0);
      await setVaultMeta('lockout_until', 0);
      return { ok: true, failedAttempts: 0, lockoutRemainingMs: 0 };
    }

    const nextFailed = throttle.failedAttempts + 1;
    const lockoutMs = lockoutDurationForAttempts(nextFailed);
    await setVaultMeta('failed_attempts', nextFailed);
    if (lockoutMs > 0) {
      await setVaultMeta('lockout_until', Date.now() + lockoutMs);
    }
    return { ok: false, failedAttempts: nextFailed, lockoutRemainingMs: lockoutMs };
  },

  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const saltB64 = await getVaultMeta<string>('salt_b64');
    const wrapIvB64 = await getVaultMeta<string>('wrap_iv_b64');
    const wrappedDekB64 = await getVaultMeta<string>('wrapped_dek_b64');
    const canary = await getVaultMeta<CipherBlob>('canary');
    if (!saltB64 || !wrapIvB64 || !wrappedDekB64 || !canary) return false;

    const subtle = getSubtle();
    let exportableDek: CryptoKey;
    try {
      const oldKek = await deriveKekFromPassphrase(oldPassphrase, base64ToBytes(saltB64));
      exportableDek = await subtle.unwrapKey(
        'raw',
        base64ToBytes(wrappedDekB64),
        oldKek,
        { name: 'AES-GCM', iv: base64ToBytes(wrapIvB64) },
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const check = await this.decryptWithKey<{ check: string }>(exportableDek, canary);
      if (check.check !== VAULT_CANARY) return false;
    } catch {
      return false;
    }

    const newSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const newWrapIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const newKek = await deriveKekFromPassphrase(newPassphrase, newSalt);
    const newWrappedBuf = await subtle.wrapKey('raw', exportableDek, newKek, {
      name: 'AES-GCM',
      iv: newWrapIv,
    });

    ramDek = await subtle.unwrapKey(
      'raw',
      newWrappedBuf,
      newKek,
      { name: 'AES-GCM', iv: newWrapIv },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    isEphemeralSession = false;

    await setVaultMeta('salt_b64', bytesToBase64(newSalt));
    await setVaultMeta('wrap_iv_b64', bytesToBase64(newWrapIv));
    await setVaultMeta('wrapped_dek_b64', bytesToBase64(new Uint8Array(newWrappedBuf)));
    return true;
  },

  async wipeAndResetVault(): Promise<void> {
    this.lock();
    await Promise.all([
      deleteDatabase(VAULT_META_DB),
      deleteDatabase(ENCOUNTER_DB_NAME),
    ]);
    broadcastVaultEvent('VAULT_WIPED');
  },

  async encryptJSON(payload: unknown): Promise<CipherBlob> {
    if (!ramDek) throw new Error('VAULT_LOCKED');
    return this.encryptWithKey(ramDek, payload);
  },

  async decryptJSON<T>(blob: CipherBlob): Promise<T> {
    if (!ramDek) throw new Error('VAULT_LOCKED');
    return this.decryptWithKey<T>(ramDek, blob);
  },
};
