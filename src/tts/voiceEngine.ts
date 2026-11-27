// src/tts/voiceEngine.ts
// 3-Tier Offline-Capable Neural Voice Engine:
//   Tier 1: Pre-rendered studio MP3/WAV clips in public/audio/ (0 ms latency)
//   Tier 2: Ninada 24 kHz neural WASM streaming (gapless Web Audio AudioBufferSourceNode queue)
//   Tier 3: Automatic window.speechSynthesis + visual caption fallback

import type { NinadaOptions, NinadaProgressEvent, NinadaVoice } from 'ninada';
import {
  type ClinicalSlots,
  getSymptomDisplay,
  LANGUAGE_META,
  type LanguageCode,
} from '../slu/schema';
import { PROMPT_CLIPS, type PromptKey } from './promptClips';

export type NeuralVoiceState = 'idle' | 'loading' | 'ready' | 'error';

export type NinadaFactory = (
  repo: string,
  opts?: NinadaOptions
) => Promise<NinadaVoice>;

export function mapAppLangToNinadaLang(lang: LanguageCode): 'hi' | 'bn' {
  // Hinglish uses Devanagari Hindi specialist so Hindi medical terms are never tokenized as raw Latin
  return lang === 'bn' ? 'bn' : 'hi';
}

export function buildNativeReadbackText(slots: ClinicalSlots, lang: LanguageCode): string {
  const target = mapAppLangToNinadaLang(lang);
  const allSymptoms = [slots.primary_symptom, ...slots.secondary_symptoms].map(
    (s) => getSymptomDisplay(s, target).spoken
  );
  const dur = slots.duration_days ?? 1;

  if (target === 'bn') {
    const joined = allSymptoms.join(' আর ');
    return `আমি শুনেছি: ${joined}, ${dur} দিন ধরে। ঠিক থাকলে হ্যাঁ বলুন, না হলে ভুল অংশ বলুন।`;
  }
  const joined = allSymptoms.join(' और ');
  return `मैंने सुना: ${joined}, ${dur} दिन से। सही है तो हाँ बोलिए, या गलत हिस्सा बोलिए।`;
}

export interface VoiceCallbacks {
  onSpeakingChange?: (speaking: boolean) => void;
  onCaption?: (text: string) => void;
  onVoicePackMissing?: (missing: boolean) => void;
  onNeuralStateChange?: (state: NeuralVoiceState, progress: number, lang: 'hi' | 'bn' | null) => void;
}

export class VoiceEngine {
  private activeVoice: NinadaVoice | null = null;
  private activeNinadaLang: 'hi' | 'bn' | null = null;
  private neuralState: NeuralVoiceState = 'idle';
  private neuralProgress = 0;

  private audioCtx: AudioContext | null = null;
  private activeAudioEl: HTMLAudioElement | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private streamAbortController: AbortController | null = null;
  private playbackGen = 0;
  private muted = false;
  private callbacks: VoiceCallbacks = {};
  private ninadaLoader: () => Promise<NinadaFactory>;

  constructor(customLoader?: () => Promise<NinadaFactory>) {
    this.ninadaLoader =
      customLoader ??
      (async () => {
        const mod = await import('ninada');
        return mod.default;
      });
  }

  setCallbacks(callbacks: VoiceCallbacks): void {
    this.callbacks = callbacks;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopSpeaking();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  getNeuralStatus(): {
    state: NeuralVoiceState;
    progress: number;
    loadedLang: 'hi' | 'bn' | null;
  } {
    return {
      state: this.neuralState,
      progress: this.neuralProgress,
      loadedLang: this.activeNinadaLang,
    };
  }

  private emitNeuralState(state: NeuralVoiceState, progress: number): void {
    this.neuralState = state;
    this.neuralProgress = progress;
    this.callbacks.onNeuralStateChange?.(state, progress, this.activeNinadaLang);
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Immediately cancels all active audio playback (HTMLAudio, Web Audio nodes,
   * Ninada streaming generator, and browser speechSynthesis) to prevent mic collision.
   */
  stopSpeaking(): void {
    this.playbackGen += 1;
    if (this.streamAbortController) {
      this.streamAbortController.abort();
      this.streamAbortController = null;
    }

    if (this.activeAudioEl) {
      try {
        this.activeAudioEl.pause();
        this.activeAudioEl.currentTime = 0;
        this.activeAudioEl.src = '';
      } catch {
        // Ignore
      }
      this.activeAudioEl = null;
    }

    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    this.activeSources.clear();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }

    this.callbacks.onSpeakingChange?.(false);
  }

  /**
   * Disposes active Ninada WASM/ONNX sessions to reclaim memory on low-RAM devices.
   */
  async dispose(): Promise<void> {
    this.stopSpeaking();
    if (this.activeVoice) {
      try {
        await this.activeVoice.dispose();
      } catch {
        // Ignore dispose errors
      }
      this.activeVoice = null;
    }
    this.activeNinadaLang = null;
    this.emitNeuralState('idle', 0);

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        await this.audioCtx.close();
      } catch {
        // Ignore
      }
      this.audioCtx = null;
    }
  }

  async loadNeuralVoice(lang: LanguageCode): Promise<boolean> {
    const targetLang = mapAppLangToNinadaLang(lang);
    if (this.activeVoice && this.activeNinadaLang === targetLang && this.neuralState === 'ready') {
      return true;
    }

    // Memory safety: dispose previous language specialist before loading a new one
    if (this.activeVoice) {
      try {
        await this.activeVoice.dispose();
      } catch {
        // Ignore
      }
      this.activeVoice = null;
      this.activeNinadaLang = null;
    }

    this.emitNeuralState('loading', 5);
    try {
      const [createNinada, ort] = await Promise.all([
        this.ninadaLoader(),
        import('onnxruntime-web'),
      ]);
      const voice = await createNinada('gnumanth/ninada', {
        lang: targetLang,
        voice: 'female',
        device: 'wasm',
        ort,
        cache: true,
        onProgress: (ev: NinadaProgressEvent) => {
          if (ev && typeof ev.percent === 'number') {
            this.emitNeuralState('loading', Math.max(5, Math.min(99, Math.round(ev.percent))));
          }
        },
      });
      this.activeVoice = voice;
      this.activeNinadaLang = targetLang;
      this.emitNeuralState('ready', 100);
      return true;
    } catch {
      this.activeVoice = null;
      this.activeNinadaLang = null;
      this.emitNeuralState('error', 0);
      return false;
    }
  }

  /**
   * Tier 1: Play pre-rendered studio audio clip for fixed clinical prompts.
   * Falls back to Tier 3 if audio playback is blocked or unavailable.
   */
  async speakPrompt(
    promptKey: PromptKey,
    lang: LanguageCode,
    fallbackText: string
  ): Promise<void> {
    this.callbacks.onCaption?.(fallbackText);
    if (this.muted) return;

    this.stopSpeaking();
    const myGen = this.playbackGen;
    const clipUrl = PROMPT_CLIPS[lang]?.[promptKey];

    if (clipUrl && typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(clipUrl);
        this.activeAudioEl = audio;
        this.callbacks.onSpeakingChange?.(true);

        await new Promise<void>((resolve, reject) => {
          audio.onended = () => {
            if (this.activeAudioEl === audio) {
              this.activeAudioEl = null;
            }
            this.callbacks.onSpeakingChange?.(false);
            resolve();
          };
          audio.onerror = () => {
            if (this.activeAudioEl === audio) {
              this.activeAudioEl = null;
            }
            this.callbacks.onSpeakingChange?.(false);
            reject(new Error('Audio clip failed'));
          };
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => reject(err));
          }
        });
        return;
      } catch {
        if (myGen !== this.playbackGen) return;
        this.stopSpeaking();
      }
    }

    if (myGen !== this.playbackGen) return;
    this.speakBrowserFallback(fallbackText, lang);
  }

  /**
   * Tier 2: Stream 24 kHz neural PCM via Ninada when loaded for the active language,
   * automatically falling back to Tier 3 (speechSynthesis + caption) if unavailable.
   */
  async speakDynamic(
    text: string,
    lang: LanguageCode,
    nativeTextOverride?: string
  ): Promise<void> {
    this.callbacks.onCaption?.(text);
    if (this.muted) return;

    this.stopSpeaking();
    const myGen = this.playbackGen;
    const targetLang = mapAppLangToNinadaLang(lang);
    const spokenText = nativeTextOverride || text;

    if (
      this.activeVoice &&
      this.activeNinadaLang === targetLang &&
      this.neuralState === 'ready'
    ) {
      const ctx = this.ensureAudioContext();
      if (ctx) {
        const controller = new AbortController();
        this.streamAbortController = controller;
        this.callbacks.onSpeakingChange?.(true);

        try {
          let nextStartTime = ctx.currentTime + 0.02;
          let lastSource: AudioBufferSourceNode | null = null;

          for await (const chunk of this.activeVoice.stream(spokenText, {
            lang: targetLang,
            voice: 'female',
            signal: controller.signal,
          })) {
            if (controller.signal.aborted || myGen !== this.playbackGen) break;
            if (!chunk.pcm || chunk.pcm.length === 0) continue;

            const sr = chunk.sampleRate || 24000;
            const buf = ctx.createBuffer(1, chunk.pcm.length, sr);
            buf.copyToChannel(new Float32Array(chunk.pcm), 0);

            const source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);

            const startAt = Math.max(ctx.currentTime, nextStartTime);
            source.start(startAt);
            nextStartTime = startAt + buf.duration;

            this.activeSources.add(source);
            lastSource = source;
            source.onended = () => {
              this.activeSources.delete(source);
              if (
                this.activeSources.size === 0 &&
                lastSource === source &&
                !this.streamAbortController
              ) {
                this.callbacks.onSpeakingChange?.(false);
              }
            };
          }

          if (this.streamAbortController === controller) {
            this.streamAbortController = null;
          }
          if (
            (!lastSource || this.activeSources.size === 0) &&
            !controller.signal.aborted &&
            myGen === this.playbackGen
          ) {
            this.callbacks.onSpeakingChange?.(false);
          }
          return;
        } catch {
          if (controller.signal.aborted || myGen !== this.playbackGen) return;
          // Cancel any already-queued Web Audio chunks before falling back to speechSynthesis
          this.stopSpeaking();
        } finally {
          if (this.streamAbortController === controller) {
            this.streamAbortController = null;
          }
        }
      }
    }

    if (myGen !== this.playbackGen) return;
    this.speakBrowserFallback(lang === 'hinglish' ? text : spokenText, lang);
  }

  private speakBrowserFallback(text: string, lang: LanguageCode): void {
    if (this.muted) return;
    const targetBcp47 = LANGUAGE_META[lang].bcp47;

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.callbacks.onVoicePackMissing?.(true);
      this.callbacks.onSpeakingChange?.(false);
      return;
    }

    try {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const langPrefix = targetBcp47.split('-')[0].toLowerCase();
        const hasVoice = voices.some((v) => v.lang.toLowerCase().startsWith(langPrefix));
        this.callbacks.onVoicePackMissing?.(!hasVoice);
      } else {
        this.callbacks.onVoicePackMissing?.(false);
      }

      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = targetBcp47;
      u.rate = 0.96;
      u.onstart = () => this.callbacks.onSpeakingChange?.(true);
      u.onend = () => this.callbacks.onSpeakingChange?.(false);
      u.onerror = () => {
        this.callbacks.onSpeakingChange?.(false);
        this.callbacks.onVoicePackMissing?.(true);
      };
      window.speechSynthesis.speak(u);
    } catch {
      this.callbacks.onSpeakingChange?.(false);
      this.callbacks.onVoicePackMissing?.(true);
    }
  }
}

export const voiceEngine = new VoiceEngine();
