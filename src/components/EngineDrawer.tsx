// src/components/EngineDrawer.tsx
// Dual-engine switcher (Whisper WASM Worker vs. Browser Speech API),
// live model load progress, Cache Storage inspector, and StorageManager persistence/quota.

import React from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { StorageUsageInfo } from '../db/storageGuard';
import type { AsrEngineMode, WorkerState } from '../slu/schema';
import type { NeuralVoiceState } from '../tts/voiceEngine';

export interface CacheBucketInfo {
  name: string;
  entries: number;
}

interface EngineDrawerProps {
  asrEngine: AsrEngineMode;
  onSelectEngine: (mode: AsrEngineMode) => void;
  workerState: WorkerState;
  workerProgress: number;
  lastDecodeMs: number | null;
  liveSnrDb: number;
  swStatus: 'checking' | 'registered' | 'unsupported';
  cacheBuckets: CacheBucketInfo[];
  storageInfo: StorageUsageInfo | null;
  neuralVoiceState: NeuralVoiceState;
  neuralVoiceProgress: number;
  neuralVoiceLang: 'hi' | 'bn' | null;
  onLoadNeuralVoice: () => void;
  onRefreshCache: () => void;
  onLoadWorker: () => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const EngineDrawer: React.FC<EngineDrawerProps> = ({
  asrEngine,
  onSelectEngine,
  workerState,
  workerProgress,
  lastDecodeMs,
  liveSnrDb,
  swStatus,
  cacheBuckets,
  storageInfo,
  neuralVoiceState,
  neuralVoiceProgress,
  neuralVoiceLang,
  onLoadNeuralVoice,
  onRefreshCache,
  onLoadWorker,
  onClose,
}) => {
  const totalCached = cacheBuckets.reduce((sum, b) => sum + b.entries, 0);

  return (
    <div className="bg-white border-b border-[#E2E0D8] px-5 py-4 space-y-3.5 text-[12px] shrink-0">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
          Edge ASR Worker &amp; PWA Cache
        </span>
        <button
          onClick={onClose}
          aria-label="Close Engine Drawer"
          className="text-[#6E6D68] hover:text-[#111111]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8]">
        <button
          onClick={() => onSelectEngine('whisper_worker')}
          className={`h-8 rounded-lg text-[11px] font-medium transition ${
            asrEngine === 'whisper_worker'
              ? 'bg-white text-[#111111] shadow-sm'
              : 'text-[#6E6D68]'
          }`}
        >
          Whisper WASM Worker
        </button>
        <button
          onClick={() => onSelectEngine('browser_speech')}
          className={`h-8 rounded-lg text-[11px] font-medium transition ${
            asrEngine === 'browser_speech'
              ? 'bg-white text-[#111111] shadow-sm'
              : 'text-[#6E6D68]'
          }`}
        >
          Browser Speech API
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
        <div className="bg-[#F6F5F1] rounded-xl p-2.5">
          <div className="text-[#6E6D68] uppercase">Worker</div>
          <div className="font-semibold text-[#111111] mt-0.5 uppercase">
            {workerState}
            {workerState === 'loading' ? ` ${workerProgress}%` : ''}
          </div>
        </div>
        <div className="bg-[#F6F5F1] rounded-xl p-2.5">
          <div className="text-[#6E6D68] uppercase">DSP · SNR</div>
          <div className="font-semibold text-[#0F3D3E] mt-0.5 tabular-nums">
            {liveSnrDb} dB
          </div>
        </div>
        <div className="bg-[#F6F5F1] rounded-xl p-2.5">
          <div className="text-[#6E6D68] uppercase">PWA Cache</div>
          <div className="font-semibold text-[#111111] mt-0.5 tabular-nums">
            {swStatus === 'registered' ? 'SW OK' : swStatus === 'checking' ? '…' : 'NO SW'} ·{' '}
            {totalCached}
          </div>
        </div>
      </div>

      {asrEngine === 'whisper_worker' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#6E6D68]">
            100–3400Hz DSP → 16kHz PCM
            {lastDecodeMs !== null ? ` · ${lastDecodeMs}ms` : ''}
          </span>
          <button
            onClick={onLoadWorker}
            disabled={workerState === 'loading' || workerState === 'ready'}
            className={`h-8 px-3 rounded-xl font-mono text-[10px] font-medium transition ${
              workerState === 'ready'
                ? 'bg-[#EAF1F0] text-[#0F3D3E]'
                : 'bg-[#0F3D3E] text-white hover:bg-[#0B2F30]'
            }`}
          >
            {workerState === 'ready'
              ? 'WASM Ready'
              : workerState === 'loading'
              ? `Loading ${workerProgress}%`
              : 'Load ~40MB ONNX'}
          </button>
        </div>
      )}

      {/* Neural Voice (Ninada 24 kHz) */}
      <div className="pt-2.5 border-t border-[#E2E0D8] space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6E6D68]">
            Neural Voice (Ninada 24 kHz)
          </span>
          <span className="font-mono text-[10px] text-[#0F3D3E]">
            {neuralVoiceState === 'ready'
              ? `Studio Clips + Ninada (${neuralVoiceLang?.toUpperCase()})`
              : 'Studio Clips + Browser Fallback'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#6E6D68]">
            27 offline prompt clips · Dynamic readback
          </span>
          <button
            onClick={onLoadNeuralVoice}
            disabled={neuralVoiceState === 'loading' || neuralVoiceState === 'ready'}
            className={`h-8 px-3 rounded-xl font-mono text-[10px] font-medium transition shrink-0 ${
              neuralVoiceState === 'ready'
                ? 'bg-[#EAF1F0] text-[#0F3D3E]'
                : 'bg-[#0F3D3E] text-white hover:bg-[#0B2F30]'
            }`}
          >
            {neuralVoiceState === 'ready'
              ? 'Ninada Ready'
              : neuralVoiceState === 'loading'
              ? `Loading ${neuralVoiceProgress}%`
              : 'Load Neural Voice (~22 MB)'}
          </button>
        </div>
      </div>

      {/* Storage Persistence & Quota */}
      {storageInfo && (
        <div className="pt-2.5 border-t border-[#E2E0D8] flex items-center justify-between font-mono text-[10px]">
          <span className="text-[#6E6D68]">
            Storage:{' '}
            <strong className={storageInfo.persisted ? 'text-[#0F3D3E]' : 'text-[#B45309]'}>
              {storageInfo.persisted ? 'Persistent' : 'Best-Effort'}
            </strong>
          </span>
          <span className="text-[#111111] tabular-nums">
            {formatBytes(storageInfo.usageBytes)} / {formatBytes(storageInfo.quotaBytes)} (
            {storageInfo.percentUsed}%)
          </span>
        </div>
      )}

      {/* Real Cache Storage Status Inspector */}
      <div className="pt-2.5 border-t border-[#E2E0D8] space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6E6D68]">
            Cache Storage Inspector
          </span>
          <button
            onClick={onRefreshCache}
            className="font-mono text-[10px] text-[#0F3D3E] hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            <span>Refresh</span>
          </button>
        </div>

        {cacheBuckets.length === 0 ? (
          <p className="font-mono text-[10px] text-[#A3A19B]">
            No Cache Storage buckets populated yet. Build &amp; serve over HTTPS/localhost.
          </p>
        ) : (
          <div className="space-y-1">
            {cacheBuckets.map((b) => (
              <div
                key={b.name}
                className="flex items-center justify-between bg-[#F6F5F1] rounded-lg px-2.5 py-1.5 font-mono text-[10px]"
              >
                <span className="text-[#111111] truncate">{b.name}</span>
                <span className="text-[#0F3D3E] font-semibold tabular-nums shrink-0">
                  {b.entries} {b.entries === 1 ? 'asset' : 'assets'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
