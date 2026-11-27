// scripts/generate-prompts.mjs
// Pre-renders all fixed clinical voice prompts into public/audio/*.mp3 (or .wav)
// using Ninada 24 kHz neural TTS + ffmpeg 48kbps mono compression.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-web';
import ninada from 'ninada';

const OUT_DIR = path.resolve('public/audio');
fs.mkdirSync(OUT_DIR, { recursive: true });

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const USE_MP3 = hasFfmpeg();
const EXT = USE_MP3 ? 'mp3' : 'wav';

// Native Unicode prompts so Ninada's Devanagari & Bengali tokenizers pronounce them naturally.
const PROMPTS = {
  hi: {
    ninadaLang: 'hi',
    clips: {
      consent: 'क्या मैं आपके लक्षण रिकॉर्ड कर सकता हूँ? हाँ या नहीं बोलिए।',
      consent_declined: 'ठीक है, रिकॉर्डिंग बंद है। आप नीचे आइकन चुन सकते हैं।',
      duration: 'यह दिक्कत कितने दिन से है?',
      noise_retry: 'आवाज़ साफ़ नहीं आई, फ़ोन पास लाकर फिर बोलिए।',
      visual_fallback: 'कृपया नीचे दिए गए आइकन चुनें।',
      duration_edit: 'कितने दिन से दिक्कत है? नया समय बोलिए।',
      symptom_edit: 'मुख्य लक्षण दोबारा बोलिए।',
      redflag: 'चेतावनी: गंभीर लक्षण मिले हैं। तुरंत डॉक्टर या पीएचसी रेफर करें।',
      saved: 'रिकॉर्ड एन्क्रिप्टेड रूप से सेव हो गया है।',
    },
  },
  hinglish: {
    ninadaLang: 'hi',
    clips: {
      consent: 'क्या मैं आपके लक्षण रिकॉर्ड कर सकता हूँ? हाँ या नहीं बोलिए।',
      consent_declined: 'ठीक है, ऑडियो रिकॉर्डिंग बंद है। टैप मोड चालू है।',
      duration: 'यह समस्या कितने दिन से है?',
      noise_retry: 'आवाज़ साफ़ नहीं आई, फ़ोन पास लाकर दोबारा बोलिए।',
      visual_fallback: 'शोर ज़्यादा है, कृपया नीचे आइकन टैप करें।',
      duration_edit: 'कितने दिन से है? दोबारा बोलिए।',
      symptom_edit: 'मुख्य लक्षण दोबारा बोलिए।',
      redflag: 'चेतावनी: गंभीर लक्षण मिले हैं। मरीज़ को तुरंत डॉक्टर के पास रेफर करें।',
      saved: 'रिकॉर्ड ऑफलाइन एन्क्रिप्टेड कतार में सेव हो गया है।',
    },
  },
  bn: {
    ninadaLang: 'bn',
    clips: {
      consent: 'আমি কি আপনার লক্ষণ রেকর্ড করতে পারি? হ্যাঁ বা না বলুন।',
      consent_declined: 'ঠিক আছে, রেকর্ডিং বন্ধ। নিচে আইকন ট্যাপ করুন।',
      duration: 'এই সমস্যা কত দিন ধরে হচ্ছে?',
      noise_retry: 'আওয়াজ পরিষ্কার নয়, ফোন কাছে এনে আবার বলুন।',
      visual_fallback: 'অনুগ্রহ করে নিচের আইকনগুলো বেছে নিন।',
      duration_edit: 'কত দিন ধরে হচ্ছে? আবার বলুন।',
      symptom_edit: 'প্রধান লক্ষণ আবার বলুন।',
      redflag: 'সতর্কতা: গুরুতর লক্ষণ পাওয়া গেছে। এখনই ডাক্তারের কাছে রেফার করুন।',
      saved: 'রিপোর্ট নিরাপদভাবে অফলাইনে সেভ হয়েছে।',
    },
  },
};

const manifest = {};

// Group by ninadaLang so we only load each ONNX specialist once and dispose cleanly
for (const ninadaLang of ['hi', 'bn']) {
  console.log(`Loading Ninada specialist for lang=${ninadaLang}...`);
  const voice = await ninada('gnumanth/ninada', {
    lang: ninadaLang,
    voice: 'female',
    device: 'wasm',
    ort,
  });

  for (const [appLang, cfg] of Object.entries(PROMPTS)) {
    if (cfg.ninadaLang !== ninadaLang) continue;
    manifest[appLang] = {};

    for (const [key, text] of Object.entries(cfg.clips)) {
      const filename = `${key}_${appLang}.${EXT}`;
      const outPath = path.join(OUT_DIR, filename);
      const tmpWav = path.join(OUT_DIR, `${key}_${appLang}.tmp.wav`);

      const wavBuf = await voice.speak(text, { lang: ninadaLang, voice: 'female' });
      fs.writeFileSync(tmpWav, Buffer.from(wavBuf));

      if (USE_MP3) {
        execFileSync(
          'ffmpeg',
          ['-y', '-i', tmpWav, '-b:a', '48k', '-ar', '24000', '-ac', '1', outPath],
          { stdio: 'ignore' }
        );
        fs.unlinkSync(tmpWav);
      } else {
        fs.renameSync(tmpWav, outPath);
      }

      const size = fs.statSync(outPath).size;
      console.log(`  Generated ${filename} (${(size / 1024).toFixed(1)} KB)`);
      manifest[appLang][key] = `/audio/${filename}`;
    }
  }

  await voice.dispose();
}

const tsOut = `// src/tts/promptClips.ts
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

export const PROMPT_CLIPS: Record<LanguageCode, Record<PromptKey, string>> = ${JSON.stringify(
  manifest,
  null,
  2
)};
`;

fs.mkdirSync(path.resolve('src/tts'), { recursive: true });
fs.writeFileSync(path.resolve('src/tts/promptClips.ts'), tsOut, 'utf-8');
console.log('Wrote src/tts/promptClips.ts');
