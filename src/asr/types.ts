// src/asr/types.ts
// Swappable ASR adapter interface so Whisper-Tiny can be replaced by IndicConformer
// or another on-device acoustic model without touching the UI.

import type { LanguageCode } from '../slu/schema';

export interface AsrTranscriptionResult {
  text: string;
  confidence: number | null;
  lang: LanguageCode;
  elapsedMs?: number;
}

export interface AsrAdapter {
  readonly id: string;
  load?: () => Promise<void>;
  transcribe: (audio: Float32Array, lang: LanguageCode) => Promise<AsrTranscriptionResult>;
}
