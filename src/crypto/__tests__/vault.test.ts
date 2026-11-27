// src/crypto/__tests__/vault.test.ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VaultCrypto } from '../vault';

describe('VaultCrypto (Envelope Encryption + Ephemeral Boot + 600k PBKDF2)', () => {
  beforeEach(async () => {
    await VaultCrypto.wipeAndResetVault();
  });

  it('rejects passphrases shorter than 6 characters', async () => {
    await expect(VaultCrypto.setupPassphrase('1234')).rejects.toThrow();
  });

  it('unlocks an ephemeral RAM-only session, encrypts/decrypts JSON, and upgrades to passphrase vault', async () => {
    expect(await VaultCrypto.isInitialized()).toBe(false);
    await VaultCrypto.unlockEphemeralSession();
    expect(VaultCrypto.isUnlocked()).toBe(true);
    expect(VaultCrypto.isEphemeral()).toBe(true);

    const ephemeralBlob = await VaultCrypto.encryptJSON({ name: 'Judge Demo', sym: 'fever' });
    const decodedEphemeral = await VaultCrypto.decryptJSON<{ name: string; sym: string }>(
      ephemeralBlob
    );
    expect(decodedEphemeral).toEqual({ name: 'Judge Demo', sym: 'fever' });

    // Upgrade ephemeral session to a persistent passphrase-wrapped vault
    await VaultCrypto.setupPassphrase('judge2026');
    expect(await VaultCrypto.isInitialized()).toBe(true);
    expect(VaultCrypto.isUnlocked()).toBe(true);
    expect(VaultCrypto.isEphemeral()).toBe(false);

    const wrappedBlob = await VaultCrypto.encryptJSON({ name: 'Persisted Patient' });
    VaultCrypto.lock();
    expect(VaultCrypto.isUnlocked()).toBe(false);

    const unlocked = await VaultCrypto.unlockWithPassphrase('judge2026');
    expect(unlocked.ok).toBe(true);
    const decodedWrapped = await VaultCrypto.decryptJSON<{ name: string }>(wrappedBlob);
    expect(decodedWrapped.name).toBe('Persisted Patient');
  });

  it('wraps DEK on setup, unlocks with correct passphrase, and encrypts/decrypts JSON', async () => {
    await VaultCrypto.setupPassphrase('asha2026');
    expect(VaultCrypto.isUnlocked()).toBe(true);

    const blob = await VaultCrypto.encryptJSON({ name: 'Sunita Devi', abha: '12-3456' });
    VaultCrypto.lock();
    expect(VaultCrypto.isUnlocked()).toBe(false);

    const unlock = await VaultCrypto.unlockWithPassphrase('asha2026');
    expect(unlock.ok).toBe(true);
    expect(VaultCrypto.isUnlocked()).toBe(true);

    const decoded = await VaultCrypto.decryptJSON<{ name: string; abha: string }>(blob);
    expect(decoded).toEqual({ name: 'Sunita Devi', abha: '12-3456' });
  });

  it('rejects wrong passphrase and increments failedAttempts', async () => {
    await VaultCrypto.setupPassphrase('secret99');
    VaultCrypto.lock();

    const bad = await VaultCrypto.unlockWithPassphrase('wrong99');
    expect(bad.ok).toBe(false);
    expect(bad.failedAttempts).toBe(1);
    expect(VaultCrypto.isUnlocked()).toBe(false);
  });

  it('re-wraps DEK on changePassphrase without re-encrypting existing records', async () => {
    await VaultCrypto.setupPassphrase('firstPass1');
    const existingCipherBlob = await VaultCrypto.encryptJSON({ patient: 'Meena Devi' });

    const changed = await VaultCrypto.changePassphrase('firstPass1', 'secondPass2');
    expect(changed).toBe(true);

    VaultCrypto.lock();
    const oldUnlock = await VaultCrypto.unlockWithPassphrase('firstPass1');
    expect(oldUnlock.ok).toBe(false);

    const newUnlock = await VaultCrypto.unlockWithPassphrase('secondPass2');
    expect(newUnlock.ok).toBe(true);

    const decrypted = await VaultCrypto.decryptJSON<{ patient: string }>(existingCipherBlob);
    expect(decrypted.patient).toBe('Meena Devi');
  });
});
