// src/components/EngineDrawer.tsx
// Simple voice & offline model drawer with optional collapsible technical diagnostics.

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
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
  const [showDetails, setShowDetails] = useState(false);
  const totalCached = cacheBuckets.reduce((sum, b) => sum + b.entries, 0);

  return (
    <div className="bg-white border-b border-[#E2E0D8] px-5 py-3.5 space-y-3 text-[12px] shrink-0">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
          Voice &amp; Offline Models
        </span>
        <button
          onClick={onClose}
          aria-label="Close Engine Drawer"
          className="text-[#6E6D68] hover:text-[#111111]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Simple 2-option speech engine toggle */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8]">
        <button
          onClick={() => onSelectEngine('browser_speech')}
          className={`h-8 rounded-lg text-[11px] font-medium transition ${
            asrEngine === 'browser_speech'
              ? 'bg-white text-[#111111] shadow-sm'
              : 'text-[#6E6D68]'
          }`}
        >
          Browser Speech (Instant)
        </button>
        <button
          onClick={() => onSelectEngine('whisper_worker')}
          className={`h-8 rounded-lg text-[11px] font-medium transition ${
            asrEngine === 'whisper_worker'
              ? 'bg-white text-[#111111] shadow-sm'
              : 'text-[#6E6D68]'
          }`}
        >
          Offline Whisper
        </button>
      </div>

      {/* Simple 2-row offline model downloads */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 bg-[#F6F5F1] rounded-xl px-3 py-2">
          <div>
            <div className="text-[11px] font-medium text-[#111111]">Offline Speech (Whisper)</div>
            <div className="text-[10px] text-[#6E6D68]">Works with zero internet (~40 MB)</div>
          </div>
          <button
            onClick={onLoadWorker}
            disabled={workerState === 'loading' || workerState === 'ready'}
            className={`h-7 px-3 rounded-lg font-mono text-[10px] font-medium transition shrink-0 ${
              workerState === 'ready'
                ? 'bg-[#EAF1F0] text-[#0F3D3E]'
                : 'bg-[#0F3D3E] text-white hover:bg-[#0B2F30]'
            }`}
          >
            {workerState === 'ready'
              ? 'Ready'
              : workerState === 'loading'
              ? `${workerProgress}%`
              : 'Download'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 bg-[#F6F5F1] rounded-xl px-3 py-2">
          <div>
            <div className="text-[11px] font-medium text-[#111111]">Offline Voice (Ninada)</div>
            <div className="text-[10px] text-[#6E6D68]">
              {neuralVoiceState === 'ready'
                ? `Loaded (${neuralVoiceLang?.toUpperCase()})`
                : '27 clips ready · Dynamic TTS (~22 MB)'}
            </div>
          </div>
          <button
            onClick={onLoadNeuralVoice}
            disabled={neuralVoiceState === 'loading' || neuralVoiceState === 'ready'}
            className={`h-7 px-3 rounded-lg font-mono text-[10px] font-medium transition shrink-0 ${
              neuralVoiceState === 'ready'
                ? 'bg-[#EAF1F0] text-[#0F3D3E]'
                : 'bg-[#0F3D3E] text-white hover:bg-[#0B2F30]'
            }`}
          >
            {neuralVoiceState === 'ready'
              ? 'Ready'
              : neuralVoiceState === 'loading'
              ? `${neuralVoiceProgress}%`
              : 'Download'}
          </button>
        </div>
      </div>

      {/* Collapsible technical details */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full flex items-center justify-between pt-1 text-[10px] font-mono text-[#6E6D68] hover:text-[#111111]"
      >
        <span>Technical Details ({swStatus === 'registered' ? 'Offline SW Ready' : swStatus})</span>
        {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {showDetails && (
        <div className="pt-2 border-t border-[#E2E0D8] space-y-2 font-mono text-[10px]">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#F6F5F1] rounded-lg p-2">
              <div className="text-[#6E6D68] uppercase">SNR</div>
              <div className="font-semibold text-[#0F3D3E] tabular-nums">{liveSnrDb} dB</div>
            </div>
            <div className="bg-[#F6F5F1] rounded-lg p-2">
              <div className="text-[#6E6D68] uppercase">Decode</div>
              <div className="font-semibold text-[#111111] tabular-nums">
                {lastDecodeMs !== null ? `${lastDecodeMs}ms` : '—'}
              </div>
            </div>
            <div className="bg-[#F6F5F1] rounded-lg p-2">
              <div className="text-[#6E6D68] uppercase">Cached</div>
              <div className="font-semibold text-[#111111] tabular-nums">{totalCached} files</div>
            </div>
          </div>

          {storageInfo && (
            <div className="flex items-center justify-between text-[#6E6D68]">
              <span>
                Storage:{' '}
                <strong className={storageInfo.persisted ? 'text-[#0F3D3E]' : 'text-[#B45309]'}>
                  {storageInfo.persisted ? 'Persistent' : 'Best-Effort'}
                </strong>
              </span>
              <span className="text-[#111111] tabular-nums">
                {formatBytes(storageInfo.usageBytes)} / {formatBytes(storageInfo.quotaBytes)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-[#6E6D68] uppercase">Cache Buckets</span>
            <button
              onClick={onRefreshCache}
              className="text-[#0F3D3E] hover:underline inline-flex items-center gap-1"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
