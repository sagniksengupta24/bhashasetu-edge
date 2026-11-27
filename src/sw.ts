/// <reference lib="webworker" />
// src/sw.ts — Workbox injectManifest Service Worker for full offline precaching + Background Sync

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const MODEL_CACHE = 'bhashasetu-models-v1';
const DB_NAME = 'BhashaSetuEdgeDB';
const STORE_NAME = 'encounters';
const SYNC_TAG = 'bhashasetu-abdm-sync';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Precache all hashed Vite JS, CSS, worker, and static assets on install
precacheAndRoute(self.__WB_MANIFEST);

// Cache-First for ML / WASM / ONNX artifacts from HuggingFace (.hf.co / .xethub.hf.co) or jsDelivr
registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    (url.pathname.endsWith('.onnx') ||
      url.pathname.endsWith('.wasm') ||
      url.hostname.includes('huggingface.co') ||
      url.hostname.endsWith('.hf.co') ||
      url.hostname.includes('cdn.jsdelivr.net')),
  new CacheFirst({
    cacheName: MODEL_CACHE,
  })
);

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener('sync', (event) => {
  const syncEvent = event as SyncEvent;
  if (syncEvent.tag === SYNC_TAG) {
    syncEvent.waitUntil(flushQueuedFhir());
  }
});

async function flushQueuedFhir(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onsuccess = () => {
      const database = req.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    req.onerror = () => reject(req.error);
  });

  if (!db.objectStoreNames.contains(STORE_NAME)) {
    db.close();
    return;
  }

  const queueable = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () =>
      resolve(
        ((req.result as Array<Record<string, unknown>>) || []).filter(
          (r) => r.sync_status === 'QUEUED' || r.sync_status === 'FAILED_RETRYABLE'
        )
      );
    req.onerror = () => reject(req.error);
  });

  for (const rec of queueable) {
    const res = await fetch('/api/abdm/fhir-intake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        'Idempotency-Key': String(rec.idempotency_key || ''),
      },
      body: JSON.stringify(rec.anonymized_fhir_envelope),
    });

    if (res.status >= 400 && res.status < 500) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        rec.sync_status = 'FAILED_4XX';
        rec.last_error = `HTTP ${res.status}`;
        tx.objectStore(STORE_NAME).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      continue;
    }

    if (res.status < 200 || res.status > 299) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        rec.sync_status = 'FAILED_RETRYABLE';
        rec.last_error = `HTTP ${res.status}`;
        tx.objectStore(STORE_NAME).put(rec);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      throw new Error(`Retry via OS Background Sync (HTTP ${res.status})`);
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      rec.sync_status = 'ACKED';
      rec.synced_at = new Date().toISOString();
      rec.last_error = undefined;
      tx.objectStore(STORE_NAME).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  db.close();
}
