// src/workers/asr.worker.ts
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
  // Single-threaded WASM avoids COOP/COEP SharedArrayBuffer requirements on standard HTTPS hosts
  env.backends.onnx.wasm.numThreads = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;

interface WorkerRequest {
  type: 'load' | 'transcribe';
  audio?: Float32Array;
  language?: string;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, audio, language } = event.data || {};

  if (type === 'load') {
    try {
      self.postMessage({ type: 'status', state: 'loading', progress: 5 });
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p && 'progress' in p && typeof p.progress === 'number') {
            self.postMessage({
              type: 'status',
              state: 'loading',
              progress: Math.round(p.progress),
            });
          }
        },
      });
      self.postMessage({ type: 'status', state: 'ready', progress: 100 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', message });
    }
    return;
  }

  if (type === 'transcribe') {
    if (!transcriber) {
      self.postMessage({ type: 'error', message: 'Worker model not loaded yet.' });
      return;
    }
    if (!audio) {
      self.postMessage({ type: 'error', message: 'No 16kHz PCM audio buffer provided.' });
      return;
    }
    try {
      self.postMessage({ type: 'status', state: 'decoding' });
      const t0 = performance.now();
      const output = await transcriber(audio, {
        language: language || 'hindi',
        task: 'transcribe',
        chunk_length_s: 15,
        stride_length_s: 3,
      });
      const elapsedMs = Math.round(performance.now() - t0);
      const text = Array.isArray(output)
        ? (output[0]?.text ?? '').trim()
        : (output?.text ?? '').trim();
      self.postMessage({ type: 'result', text, elapsedMs });
      self.postMessage({ type: 'status', state: 'ready' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'error', message });
      self.postMessage({ type: 'status', state: 'ready' });
    }
  }
};
