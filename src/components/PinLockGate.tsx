// src/components/PinLockGate.tsx
// Minimalist 6-digit PIN / 6+ char passphrase gate with escalating brute-force throttle
// (30s after 5 failures, 120s after 8) and two-step vault reset.

import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, RotateCcw } from 'lucide-react';
import { MIN_PASSPHRASE_LENGTH, VaultCrypto } from '../crypto/vault';

interface PinLockGateProps {
  onUnlocked: () => void;
  onCancel?: () => void;
}

export const PinLockGate: React.FC<PinLockGateProps> = ({ onUnlocked, onCancel }) => {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [passphraseMode, setPassphraseMode] = useState<boolean>(false);
  const [pin, setPin] = useState<string>('');
  const pinRef = useRef<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);
  const [confirmWipe, setConfirmWipe] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const isInit = await VaultCrypto.isInitialized();
      const throttle = await VaultCrypto.getThrottleState();
      if (!active) return;
      setInitialized(isInit);
      if (throttle.lockoutRemainingMs > 0) {
        setLockoutSeconds(Math.ceil(throttle.lockoutRemainingMs / 1000));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const submitSecret = async (secret: string) => {
    if (busy || lockoutSeconds > 0 || secret.length < MIN_PASSPHRASE_LENGTH) return;
    setBusy(true);
    setError('');
    try {
      if (initialized) {
        const result = await VaultCrypto.unlockWithPassphrase(secret);
        if (result.ok) {
          onUnlocked();
        } else if (result.lockoutRemainingMs > 0) {
          const secs = Math.ceil(result.lockoutRemainingMs / 1000);
          setLockoutSeconds(secs);
          setError(`Too many attempts · Locked for ${secs}s`);
          pinRef.current = '';
          setPin('');
        } else {
          setError(`Incorrect passphrase/PIN (attempt ${result.failedAttempts})`);
          pinRef.current = '';
          setPin('');
        }
      } else {
        await VaultCrypto.setupPassphrase(secret);
        onUnlocked();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vault key derivation failed');
      pinRef.current = '';
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const handleDigit = async (digit: string) => {
    if (busy || lockoutSeconds > 0 || pinRef.current.length >= MIN_PASSPHRASE_LENGTH) return;
    const next = pinRef.current + digit;
    pinRef.current = next;
    setPin(next);
    setError('');
    setConfirmWipe(false);
    if (next.length === MIN_PASSPHRASE_LENGTH) {
      await submitSecret(next);
    }
  };

  const handleWipeVault = async () => {
    setBusy(true);
    try {
      await VaultCrypto.wipeAndResetVault();
      setInitialized(false);
      setPin('');
      setError('');
      setLockoutSeconds(0);
      setConfirmWipe(false);
    } finally {
      setBusy(false);
    }
  };

  if (initialized === null) {
    return (
      <div className="min-h-screen w-full bg-[#E8E6DF] flex items-center justify-center">
        <span className="font-mono text-xs text-[#6E6D68]">Initializing Vault…</span>
      </div>
    );
  }

  const keypadLocked = busy || lockoutSeconds > 0;

  return (
    <div
      className="min-h-screen w-full bg-[#E8E6DF] text-[#111111] flex items-start sm:items-center justify-center sm:py-8 sm:px-4 antialiased"
      style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <div className="w-full max-w-[430px] min-h-screen sm:min-h-[820px] bg-[#F6F5F1] sm:rounded-[36px] sm:border sm:border-[#E2E0D8] sm:shadow-[0_24px_60px_-20px_rgba(17,17,17,0.16)] flex flex-col justify-between p-6">
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[17px] font-semibold tracking-[-0.03em] text-[#111111]">
              BhashaSetu
            </span>
            <span className="font-mono text-[9px] font-medium tracking-[0.08em] text-[#6E6D68] border border-[#E2E0D8] rounded px-1.5 py-0.5 uppercase">
              EDGE
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#0F3D3E] inline-flex items-center gap-1">
            <Lock className="w-3 h-3" />
            <span>ENVELOPE DEK</span>
          </span>
        </div>

        <div className="bg-white rounded-3xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] p-6 space-y-5 my-auto">
          <div className="text-center space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#0F3D3E]">
              PBKDF2 · 600k SHA-256 · AES-256-GCM
            </p>
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#111111]">
              {initialized ? 'Unlock ASHA Vault' : 'Create 6-Digit PIN / Passphrase'}
            </h1>
            <p className="text-[12px] leading-relaxed text-[#6E6D68]">
              {initialized
                ? 'Unwraps non-extractable DEK strictly in RAM. Auto-locks on idle or hide.'
                : 'Wraps a random 256-bit DEK in IndexedDB. Minimum 6 digits or characters.'}
            </p>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                setPassphraseMode((prev) => !prev);
                setPin('');
                setError('');
              }}
              className="font-mono text-[10px] text-[#0F3D3E] hover:underline inline-flex items-center gap-1"
            >
              <KeyRound className="w-3 h-3" />
              <span>{passphraseMode ? 'Switch to 6-Digit Numpad' : 'Use 6+ Char Passphrase'}</span>
            </button>
          </div>

          {!passphraseMode ? (
            <>
              <div className="flex items-center justify-center gap-3 py-1">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={`w-3 h-3 rounded-full border transition-all duration-150 ${
                      i < pin.length
                        ? 'bg-[#0F3D3E] border-[#0F3D3E] scale-110'
                        : 'bg-transparent border-[#C8C5BC]'
                    }`}
                  />
                ))}
              </div>

              {lockoutSeconds > 0 ? (
                <p className="text-center font-mono text-[12px] font-semibold text-[#C84B31] tabular-nums">
                  Keypad locked · Retry in {lockoutSeconds}s
                </p>
              ) : error ? (
                <p className="text-center text-[12px] font-medium text-[#C84B31]">{error}</p>
              ) : null}

              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, idx) =>
                  key === '' ? (
                    <div key={idx} />
                  ) : (
                    <button
                      key={idx}
                      disabled={keypadLocked}
                      onClick={() => {
                        if (key === '⌫') {
                          const next = pinRef.current.slice(0, -1);
                          pinRef.current = next;
                          setPin(next);
                        } else {
                          void handleDigit(key);
                        }
                      }}
                      className={`h-13 py-3 rounded-2xl border text-[18px] font-mono font-medium transition ${
                        keypadLocked
                          ? 'bg-[#F6F5F1]/60 border-[#E2E0D8] text-[#A3A19B] cursor-not-allowed'
                          : 'bg-[#F6F5F1] hover:bg-[#EAF1F0] border-[#E2E0D8] text-[#111111] active:scale-[0.97]'
                      }`}
                    >
                      {key}
                    </button>
                  )
                )}
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitSecret(pin);
              }}
              className="space-y-3"
            >
              <input
                type="password"
                value={pin}
                disabled={keypadLocked}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter 6+ character passphrase"
                className="w-full h-11 px-3.5 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8] text-[13px] focus:outline-none focus:border-[#0F3D3E]"
              />
              {lockoutSeconds > 0 ? (
                <p className="text-center font-mono text-[12px] font-semibold text-[#C84B31] tabular-nums">
                  Vault locked · Retry in {lockoutSeconds}s
                </p>
              ) : error ? (
                <p className="text-center text-[12px] font-medium text-[#C84B31]">{error}</p>
              ) : null}
              <button
                type="submit"
                disabled={keypadLocked || pin.length < MIN_PASSPHRASE_LENGTH}
                className="w-full h-11 rounded-2xl bg-[#0F3D3E] disabled:bg-[#111111]/10 text-white disabled:text-[#A3A19B] text-[13px] font-medium transition"
              >
                {busy ? 'Deriving 600k PBKDF2…' : initialized ? 'Unlock Vault' : 'Create Vault'}
              </button>
            </form>
          )}

          {!initialized && onCancel && (
            <div className="pt-2 border-t border-[#E2E0D8] text-center">
              <button
                type="button"
                onClick={onCancel}
                className="font-mono text-[10px] text-[#6E6D68] hover:text-[#111111] transition"
              >
                Cancel · Continue Ephemeral Session
              </button>
            </div>
          )}

          {initialized && (
            <div className="pt-2 border-t border-[#E2E0D8] text-center">
              {!confirmWipe ? (
                <button
                  type="button"
                  onClick={() => setConfirmWipe(true)}
                  className="font-mono text-[10px] text-[#6E6D68] hover:text-[#C84B31] transition inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Forgot PIN? Wipe &amp; Reset Vault</span>
                </button>
              ) : (
                <div className="space-y-2 bg-[#FEF2F2] border border-[#C84B31]/25 rounded-2xl p-3">
                  <p className="text-[11px] text-[#991B1B] leading-snug">
                    Deletes all encrypted local records and resets vault. Cannot be undone.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmWipe(false)}
                      className="h-8 rounded-xl bg-white border border-[#E2E0D8] text-[11px] font-medium text-[#111111]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleWipeVault}
                      className="h-8 rounded-xl bg-[#C84B31] text-white text-[11px] font-medium hover:bg-[#A63B24]"
                    >
                      Confirm Wipe
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center font-mono text-[10px] text-[#6E6D68] pb-2">
          DESIGNED WITH REFERENCE TO ICMR 2023 &amp; DPDP
        </p>
      </div>
    </div>
  );
};
