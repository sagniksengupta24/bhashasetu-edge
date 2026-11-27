// src/db/storageGuard.ts
// Browser StorageManager persistence & quota helpers + QuotaExceededError detection.

export interface StorageUsageInfo {
  persisted: boolean | null;
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore unsupported environments
  }
  return null;
}

export async function getStorageUsage(): Promise<StorageUsageInfo> {
  let persisted: boolean | null = null;
  let usageBytes = 0;
  let quotaBytes = 0;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usageBytes = est.usage ?? 0;
        quotaBytes = est.quota ?? 0;
      }
    }
  } catch {
    // Ignore unsupported environments
  }

  const percentUsed =
    quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1000) / 10) : 0;

  return { persisted, usageBytes, quotaBytes, percentUsed };
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}
