// src/sync/queue.ts
// Split IndexedDB store (encrypted_pii + coarse-dated anonymized_fhir_envelope),
// strict encounter state machine, Web Locks multi-tab sync guard,
// stale ephemeral record pruning, encrypted backup export, and real FastAPI sync.

import { VaultCrypto } from '../crypto/vault';
import { isQuotaExceededError } from '../db/storageGuard';
import { buildAnonymizedAbdmFhirBundle } from '../slu/parser';
import type {
  ClinicalSlots,
  DecryptedEncounter,
  EncounterPII,
  StoredEncounterRecord,
} from '../slu/schema';

const ENCOUNTER_DB_NAME = 'BhashaSetuEdgeDB';
const ENCOUNTER_STORE_NAME = 'encounters';
const BG_SYNC_TAG = 'bhashasetu-abdm-sync';
const DEVICE_ID_KEY = 'bhashasetu_device_id';
const BACKOFF_DELAYS_MS = [1000, 2000, 4000];

function broadcastQueueEvent(type: 'QUEUE_UPDATED'): void {
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

export function getSyncEndpoint(): string {
  const configured = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_ABDM_SYNC_URL;
  return configured && configured.trim().length > 0
    ? configured.trim()
    : '/api/abdm/fhir-intake';
}

export function getDeviceId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const created = globalThis.crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    }
  } catch {
    // Fallback if localStorage is restricted
  }
  return 'ephemeral-device';
}

function openEncounterDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(ENCOUNTER_DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENCOUNTER_STORE_NAME)) {
        db.createObjectStore(ENCOUNTER_STORE_NAME, { keyPath: 'encounter_id' });
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

export async function dbSaveEncounter(record: StoredEncounterRecord): Promise<void> {
  const db = await openEncounterDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ENCOUNTER_STORE_NAME, 'readwrite');
      tx.objectStore(ENCOUNTER_STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new Error('STORAGE_QUOTA_EXCEEDED');
    }
    throw err;
  } finally {
    db.close();
  }

  broadcastQueueEvent('QUEUE_UPDATED');

  if (record.sync_status === 'QUEUED' || record.sync_status === 'FAILED_RETRYABLE') {
    await registerBackgroundSync();
  }
}

async function dbDeleteEncounters(encounterIds: string[]): Promise<void> {
  if (encounterIds.length === 0) return;
  const db = await openEncounterDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ENCOUNTER_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ENCOUNTER_STORE_NAME);
      for (const id of encounterIds) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function registerBackgroundSync(): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const syncReg = reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      };
      if (syncReg.sync) {
        await syncReg.sync.register(BG_SYNC_TAG);
      }
    }
  } catch {
    // Graceful fallback outside HTTPS SW scope or in Safari/Firefox
  }
}

export async function dbLoadDecryptedEncounters(): Promise<{
  records: DecryptedEncounter[];
  prunedEphemeralCount: number;
}> {
  try {
    const db = await openEncounterDB();
    const rows = await new Promise<StoredEncounterRecord[]>((resolve, reject) => {
      const tx = db.transaction(ENCOUNTER_STORE_NAME, 'readonly');
      const req = tx.objectStore(ENCOUNTER_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredEncounterRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const out: DecryptedEncounter[] = [];
    const staleEphemeralIds: string[] = [];

    for (const stored of rows) {
      try {
        const pii = await VaultCrypto.decryptJSON<EncounterPII>(stored.encrypted_pii);
        out.push({ stored, pii });
      } catch {
        // Silently prune stale ephemeral rows whose RAM key was cleared on refresh
        if (stored.is_ephemeral) {
          staleEphemeralIds.push(stored.encounter_id);
        }
      }
    }

    if (staleEphemeralIds.length > 0) {
      await dbDeleteEncounters(staleEphemeralIds).catch(() => {});
    }

    out.sort(
      (a, b) => new Date(b.stored.created_at).getTime() - new Date(a.stored.created_at).getTime()
    );
    return { records: out, prunedEphemeralCount: staleEphemeralIds.length };
  } catch {
    return { records: [], prunedEphemeralCount: 0 };
  }
}

export async function createSeedEncounter(): Promise<DecryptedEncounter> {
  const createdAt = new Date(Date.now() - 1000 * 60 * 34).toISOString();
  const slots: ClinicalSlots = {
    primary_symptom: 'high_fever',
    secondary_symptoms: ['abdominal_pain'],
    resolved_symptoms: [],
    negated_symptoms: [],
    duration_days: 2,
    severity_grade: 'moderate',
    spoken_vitals: { bp: '128/84 mmHg', temperature: null, sugar: null, medications: [] },
    confidence_score: 0.95,
    requires_clinician_review: false,
  };
  const pii: EncounterPII = {
    patient: { name: 'Meena Devi', age: '42', sex: 'F', abha_id: '24-5819-4402-9104' },
    raw_transcript: 'Patient ko do din se tej bukhar hai aur pet mein dard hai, BP 128/84',
    consent_timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    consent_mode: 'verbal_granted',
  };
  const encounterId = globalThis.crypto.randomUUID();
  const encrypted_pii = await VaultCrypto.encryptJSON(pii);
  const stored: StoredEncounterRecord = {
    encounter_id: encounterId,
    idempotency_key: encounterId,
    created_at: createdAt,
    language: 'hinglish',
    asr_engine: 'whisper_worker',
    snr_db: 21,
    red_flags_triggered: [],
    slots,
    sync_status: 'QUEUED',
    retry_count: 0,
    is_ephemeral: VaultCrypto.isEphemeral(),
    encrypted_pii,
    anonymized_fhir_envelope: buildAnonymizedAbdmFhirBundle({
      encounterId,
      createdAt,
      language: 'hinglish',
      slots,
    }),
  };
  await dbSaveEncounter(stored);
  return { stored, pii };
}

export interface FlushQueueOptions {
  simulateFlaky3G?: boolean;
  onTelemetry?: (msg: string) => void;
  onRecordUpdated?: (updated: DecryptedEncounter) => void;
}

export interface FlushQueueResult {
  ackedCount: number;
  demoSimulatedCount: number;
  deadLetterCount: number;
  backendUnreachable: boolean;
  skippedDueToLock?: boolean;
  updatedRecords: DecryptedEncounter[];
}

async function runFlushInternal(
  records: DecryptedEncounter[],
  options?: FlushQueueOptions
): Promise<FlushQueueResult> {
  const queueable = records.filter(
    (r) => r.stored.sync_status === 'QUEUED' || r.stored.sync_status === 'FAILED_RETRYABLE'
  );
  if (queueable.length === 0) {
    return {
      ackedCount: 0,
      demoSimulatedCount: 0,
      deadLetterCount: 0,
      backendUnreachable: false,
      updatedRecords: records,
    };
  }

  const endpoint = getSyncEndpoint();
  const deviceId = getDeviceId();
  const updatedList = [...records];
  let ackedCount = 0;
  let demoSimulatedCount = 0;
  let deadLetterCount = 0;
  let backendUnreachable = false;

  for (const rec of queueable) {
    const idx = updatedList.findIndex(
      (item) => item.stored.encounter_id === rec.stored.encounter_id
    );
    if (idx === -1) continue;

    const sendingRecord: StoredEncounterRecord = {
      ...updatedList[idx].stored,
      sync_status: 'SENDING',
    };
    updatedList[idx] = { stored: sendingRecord, pii: updatedList[idx].pii };
    options?.onRecordUpdated?.(updatedList[idx]);

    let finalStatus: StoredEncounterRecord['sync_status'] = 'FAILED_RETRYABLE';
    let lastError: string | undefined;
    let attemptsUsed = 0;

    if (options?.simulateFlaky3G) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        attemptsUsed = attempt;
        options?.onTelemetry?.(
          `[DEMO] POST ${endpoint} · Idempotency-Key: ${rec.stored.idempotency_key.slice(0, 8)}… (try ${attempt}/3)`
        );
        await new Promise((r) => setTimeout(r, 320));
        if (attempt < 3) {
          const waitMs = BACKOFF_DELAYS_MS[attempt - 1];
          options?.onTelemetry?.(
            `${rec.stored.encounter_id.slice(0, 8)} · Simulated 503 (try ${attempt}/3) → backoff ${waitMs / 1000}s…`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        finalStatus = 'DEMO_SIMULATED';
        lastError = 'Simulated flaky 3G test (no server ACK)';
        break;
      }
    } else {
      for (let attempt = 1; attempt <= 3; attempt++) {
        attemptsUsed = attempt;
        options?.onTelemetry?.(
          `POST ${endpoint} · Idempotency-Key: ${rec.stored.idempotency_key.slice(0, 8)}… (try ${attempt}/3)`
        );

        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/fhir+json',
              'Idempotency-Key': rec.stored.idempotency_key,
              'X-Device-Id': deviceId,
            },
            body: JSON.stringify(rec.stored.anonymized_fhir_envelope),
          });

          if (res.status >= 200 && res.status <= 299) {
            finalStatus = 'ACKED';
            lastError = undefined;
            break;
          }

          if (res.status >= 400 && res.status < 500) {
            finalStatus = 'FAILED_4XX';
            lastError = `HTTP ${res.status} Schema Rejected`;
            break;
          }

          finalStatus = 'FAILED_RETRYABLE';
          lastError = `HTTP ${res.status} Server Error`;
          backendUnreachable = true;
          const waitMs = BACKOFF_DELAYS_MS[attempt - 1];
          options?.onTelemetry?.(
            `${rec.stored.encounter_id.slice(0, 8)} · HTTP ${res.status} (try ${attempt}/3) → backoff ${waitMs / 1000}s…`
          );
          await new Promise((r) => setTimeout(r, waitMs));
        } catch (err) {
          finalStatus = 'FAILED_RETRYABLE';
          lastError = err instanceof Error ? err.message : 'Backend unreachable';
          backendUnreachable = true;
          const waitMs = BACKOFF_DELAYS_MS[attempt - 1];
          options?.onTelemetry?.(
            `${rec.stored.encounter_id.slice(0, 8)} · Network error (try ${attempt}/3) → backoff ${waitMs / 1000}s…`
          );
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }

    const nextStored: StoredEncounterRecord = {
      ...updatedList[idx].stored,
      sync_status: finalStatus,
      synced_at: finalStatus === 'ACKED' ? new Date().toISOString() : undefined,
      last_error: lastError,
      retry_count: updatedList[idx].stored.retry_count + attemptsUsed,
    };

    try {
      await dbSaveEncounter(nextStored);
    } catch {
      // Ignore IDB write error
    }

    const nextDecrypted: DecryptedEncounter = {
      stored: nextStored,
      pii: updatedList[idx].pii,
    };
    updatedList[idx] = nextDecrypted;
    options?.onRecordUpdated?.(nextDecrypted);

    if (finalStatus === 'ACKED') ackedCount++;
    if (finalStatus === 'DEMO_SIMULATED') demoSimulatedCount++;
    if (finalStatus === 'FAILED_4XX') deadLetterCount++;
  }

  return {
    ackedCount,
    demoSimulatedCount,
    deadLetterCount,
    backendUnreachable,
    updatedRecords: updatedList,
  };
}

export async function flushPendingQueue(
  records: DecryptedEncounter[],
  options?: FlushQueueOptions
): Promise<FlushQueueResult> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(
      'bhashasetu-sync-lock',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return {
            ackedCount: 0,
            demoSimulatedCount: 0,
            deadLetterCount: 0,
            backendUnreachable: false,
            skippedDueToLock: true,
            updatedRecords: records,
          };
        }
        return runFlushInternal(records, options);
      }
    );
  }
  return runFlushInternal(records, options);
}

export async function exportEncryptedBackupBundle(
  records: DecryptedEncounter[]
): Promise<string> {
  const vaultMeta = await VaultCrypto.exportWrappedMetadata();
  const payload = {
    format: 'bhashasetu-encrypted-backup-v1',
    exported_at: new Date().toISOString(),
    device_id: getDeviceId(),
    vault_meta: vaultMeta,
    encounters: records.map((r) => r.stored),
  };
  const filename = `bhashasetu-backup-${new Date().toISOString().slice(0, 10)}.bse.json`;
  downloadFile(filename, JSON.stringify(payload, null, 2));
  return filename;
}

export function registerOnlineSyncFallback(onOnlineFlush: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    onOnlineFlush();
  };
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
