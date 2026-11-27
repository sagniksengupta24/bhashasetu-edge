// src/tts/__tests__/voiceEngine.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_CLIPS } from '../promptClips';
import {
  buildNativeReadbackText,
  mapAppLangToNinadaLang,
  VoiceEngine,
} from '../voiceEngine';

describe('VoiceEngine (3-Tier Ninada + Pre-Rendered Clips + Fallback)', () => {
  const originalAudio = globalThis.Audio;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    globalThis.window = originalWindow;
  });

  it('1. maps fixed prompts across hi, hinglish, and bn in PROMPT_CLIPS and plays Tier 1 clip', async () => {
    expect(PROMPT_CLIPS.hi.consent).toBe('/audio/consent_hi.mp3');
    expect(PROMPT_CLIPS.hinglish.duration).toBe('/audio/duration_hinglish.mp3');
    expect(PROMPT_CLIPS.bn.redflag).toBe('/audio/redflag_bn.mp3');

    const playedUrls: string[] = [];
    class MockAudio {
      src: string;
      currentTime = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url = '') {
        this.src = url;
        playedUrls.push(url);
      }
      play() {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
      pause() {}
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;

    const engine = new VoiceEngine();
    const captions: string[] = [];
    engine.setCallbacks({ onCaption: (t) => captions.push(t) });

    await engine.speakPrompt('consent', 'hi', 'Kya main aapke lakshan record kar sakta hoon?');
    expect(playedUrls).toEqual(['/audio/consent_hi.mp3']);
    expect(captions[0]).toContain('lakshan');
  });

  it('2. routes hi/hinglish to Devanagari hi and bn to Bengali bn (never raw romanized Hindi)', () => {
    expect(mapAppLangToNinadaLang('hi')).toBe('hi');
    expect(mapAppLangToNinadaLang('hinglish')).toBe('hi');
    expect(mapAppLangToNinadaLang('bn')).toBe('bn');

    const hiReadback = buildNativeReadbackText(
      {
        primary_symptom: 'high_fever',
        secondary_symptoms: [],
        resolved_symptoms: [],
        negated_symptoms: [],
        duration_days: 2,
        severity_grade: 'moderate',
        spoken_vitals: { bp: null, temperature: null, sugar: null, medications: [] },
        confidence_score: 0.95,
      },
      'hinglish'
    );
    expect(hiReadback).toMatch(/[\u0900-\u097F]/);

    const bnReadback = buildNativeReadbackText(
      {
        primary_symptom: 'chest_heaviness',
        secondary_symptoms: [],
        resolved_symptoms: [],
        negated_symptoms: [],
        duration_days: 1,
        severity_grade: 'critical_red_flag',
        spoken_vitals: { bp: null, temperature: null, sugar: null, medications: [] },
        confidence_score: 0.95,
      },
      'bn'
    );
    expect(bnReadback).toMatch(/[\u0980-\u09FF]/);
  });

  it('3. stopSpeaking() immediately cancels active HTMLAudio and speechSynthesis', async () => {
    const pauseSpy = vi.fn();
    const cancelSpy = vi.fn();

    class HangingAudio {
      src = '';
      currentTime = 5;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url = '') {
        this.src = url;
      }
      play() {
        return new Promise<void>(() => {});
      }
      pause() {
        pauseSpy();
      }
    }
    globalThis.Audio = HangingAudio as unknown as typeof Audio;
    globalThis.window = {
      speechSynthesis: {
        cancel: cancelSpy,
        getVoices: () => [],
        speak: vi.fn(),
      },
    } as unknown as Window & typeof globalThis;

    const engine = new VoiceEngine();
    void engine.speakPrompt('duration', 'bn', 'Ei somosha koto din?');
    engine.stopSpeaking();

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('4. falls back to speechSynthesis + caption callback when Ninada is unavailable or throws', async () => {
    const speakSpy = vi.fn();
    const cancelSpy = vi.fn();
    globalThis.window = {
      speechSynthesis: {
        cancel: cancelSpy,
        getVoices: () => [{ lang: 'hi-IN' }],
        speak: speakSpy,
      },
    } as unknown as Window & typeof globalThis;
    globalThis.SpeechSynthesisUtterance = class {
      text: string;
      lang = '';
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    } as unknown as typeof SpeechSynthesisUtterance;

    const failingLoader = vi.fn().mockRejectedValue(new Error('Offline model missing'));
    const engine = new VoiceEngine(failingLoader);
    const captions: string[] = [];
    engine.setCallbacks({ onCaption: (t) => captions.push(t) });

    const loaded = await engine.loadNeuralVoice('hi');
    expect(loaded).toBe(false);
    expect(engine.getNeuralStatus().state).toBe('error');

    await engine.speakDynamic('Maine suna: bukhar, 2 din se.', 'hi');
    expect(captions).toContain('Maine suna: bukhar, 2 din se.');
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it('5. calls dispose() on previous language specialist when switching hi -> bn', async () => {
    const hiDispose = vi.fn().mockResolvedValue(undefined);
    const bnDispose = vi.fn().mockResolvedValue(undefined);

    const factory = vi.fn(async (_repo: string, opts?: { lang?: string }) => ({
      lang: opts?.lang || 'hi',
      isNeural: true,
      isStreamingNeural: true,
      setVoiceBank: vi.fn(),
      dispose: opts?.lang === 'bn' ? bnDispose : hiDispose,
      on: vi.fn(),
      inspect: vi.fn(),
      stream: vi.fn(),
      synthesize: vi.fn(),
      speak: vi.fn(),
    }));

    const engine = new VoiceEngine(async () => factory as never);
    await engine.loadNeuralVoice('hi');
    expect(engine.getNeuralStatus().loadedLang).toBe('hi');

    await engine.loadNeuralVoice('bn');
    expect(hiDispose).toHaveBeenCalledTimes(1);
    expect(engine.getNeuralStatus().loadedLang).toBe('bn');

    await engine.dispose();
    expect(bnDispose).toHaveBeenCalledTimes(1);
  });
});
