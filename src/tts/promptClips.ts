// src/tts/promptClips.ts
// Auto-generated manifest mapping (promptKey, LanguageCode) -> pre-rendered studio audio clip.

import type { LanguageCode } from '../slu/schema';

export type PromptKey =
  | 'consent'
  | 'consent_declined'
  | 'duration'
  | 'noise_retry'
  | 'visual_fallback'
  | 'duration_edit'
  | 'symptom_edit'
  | 'redflag'
  | 'saved';

export const PROMPT_CLIPS: Record<LanguageCode, Record<PromptKey, string>> = {
  "hi": {
    "consent": "/audio/consent_hi.mp3",
    "consent_declined": "/audio/consent_declined_hi.mp3",
    "duration": "/audio/duration_hi.mp3",
    "noise_retry": "/audio/noise_retry_hi.mp3",
    "visual_fallback": "/audio/visual_fallback_hi.mp3",
    "duration_edit": "/audio/duration_edit_hi.mp3",
    "symptom_edit": "/audio/symptom_edit_hi.mp3",
    "redflag": "/audio/redflag_hi.mp3",
    "saved": "/audio/saved_hi.mp3"
  },
  "hinglish": {
    "consent": "/audio/consent_hinglish.mp3",
    "consent_declined": "/audio/consent_declined_hinglish.mp3",
    "duration": "/audio/duration_hinglish.mp3",
    "noise_retry": "/audio/noise_retry_hinglish.mp3",
    "visual_fallback": "/audio/visual_fallback_hinglish.mp3",
    "duration_edit": "/audio/duration_edit_hinglish.mp3",
    "symptom_edit": "/audio/symptom_edit_hinglish.mp3",
    "redflag": "/audio/redflag_hinglish.mp3",
    "saved": "/audio/saved_hinglish.mp3"
  },
  "bn": {
    "consent": "/audio/consent_bn.mp3",
    "consent_declined": "/audio/consent_declined_bn.mp3",
    "duration": "/audio/duration_bn.mp3",
    "noise_retry": "/audio/noise_retry_bn.mp3",
    "visual_fallback": "/audio/visual_fallback_bn.mp3",
    "duration_edit": "/audio/duration_edit_bn.mp3",
    "symptom_edit": "/audio/symptom_edit_bn.mp3",
    "redflag": "/audio/redflag_bn.mp3",
    "saved": "/audio/saved_bn.mp3"
  }
};
