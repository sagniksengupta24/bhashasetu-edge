// src/slu/schema.ts
// Isolated, swappable clinical slot schema, trilingual (Hindi / Hinglish / Bengali) prompts,
// synonym maps, temporal/negation triggers, medication lexicon, and red-flag rules + SNOMED-CT/LOINC codes.

import type { CipherBlob } from '../crypto/vault';

export type LanguageCode = 'hi' | 'hinglish' | 'bn';
export type ViewMode = 'home' | 'intake' | 'queue';
export type IntakeStep = 1 | 2 | 3 | 4;
export type SeverityGrade = 'mild' | 'moderate' | 'severe' | 'critical_red_flag';
export type AsrEngineMode = 'whisper_worker' | 'browser_speech';
export type WorkerState = 'idle' | 'loading' | 'ready' | 'decoding' | 'error';
export type ModalTab = 'slip' | 'fhir' | 'json' | 'cipher';

export type SyncStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'SENDING'
  | 'ACKED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_4XX'
  | 'DEMO_SIMULATED';

export interface PatientProfile {
  name: string;
  age: string;
  sex: 'F' | 'M' | 'O';
  abha_id: string;
}

export interface SpokenVitals {
  bp: string | null;
  temperature: string | null;
  sugar: string | null;
  medications: string[];
}

export interface ClinicalSlots {
  primary_symptom: string;
  secondary_symptoms: string[];
  resolved_symptoms: string[];
  negated_symptoms: string[];
  duration_days: number | null;
  severity_grade: SeverityGrade;
  spoken_vitals: SpokenVitals;
  confidence_score: number;
  requires_clinician_review?: boolean;
}

/** Sensitive PII/PHI encrypted via RAM-only AES-256-GCM DEK */
export interface EncounterPII {
  patient: PatientProfile;
  raw_transcript: string;
  consent_timestamp: string;
  consent_mode: 'verbal_granted' | 'declined_manual_tap';
}

/** Split IndexedDB storage envelope: encrypted PII + coarse-dated zero-PII FHIR bundle */
export interface StoredEncounterRecord {
  encounter_id: string;
  idempotency_key: string;
  created_at: string;
  language: LanguageCode;
  asr_engine: AsrEngineMode | 'simulator';
  snr_db: number;
  red_flags_triggered: string[];
  slots: ClinicalSlots;
  sync_status: SyncStatus;
  synced_at?: string;
  last_error?: string;
  retry_count: number;
  is_ephemeral?: boolean;
  encrypted_pii: CipherBlob;
  anonymized_fhir_envelope: Record<string, unknown>;
}

/** In-memory decrypted record for UI display (only exists while Vault is unlocked) */
export interface DecryptedEncounter {
  stored: StoredEncounterRecord;
  pii: EncounterPII;
}

export interface LanguageMeta {
  codeLabel: string;
  name: string;
  nativeScript: string;
  sublabel: string;
  bcp47: string;
  whisperLang: string;
  consentPrompt: string;
  consentDeclined: string;
  durationPrompt: string;
  noiseRetryPrompt: string;
  visualFallbackPrompt: string;
  readbackPrefix: string;
  readbackSuffix: string;
  durationEditPrompt: string;
  symptomEditPrompt: string;
  emergencyAlert: string;
  savedConfirm: string;
  daysWord: string;
  andWord: string;
  confirmWord: string;
  declineWord: string;
}

export const LANGUAGE_META: Record<LanguageCode, LanguageMeta> = {
  hi: {
    codeLabel: 'HI',
    name: 'Hindi',
    nativeScript: 'हिन्दी',
    sublabel: 'Hindi · हिंदी में लक्षण दर्ज करें',
    bcp47: 'hi-IN',
    whisperLang: 'hindi',
    consentPrompt: 'Kya main aapke lakshan record kar sakta hoon? Haan ya Nahi boliye.',
    consentDeclined: 'Theek hai, recording band hai. Aap neeche icon chun sakte hain.',
    durationPrompt: 'Yeh dikkat kitne din se hai?',
    noiseRetryPrompt: 'Awaaz saaf nahi aayi, phone paas laakar phir boliye.',
    visualFallbackPrompt: 'Kripya neeche diye gaye icons chunein.',
    readbackPrefix: 'Maine suna:',
    readbackSuffix: 'Sahi hai toh Haan boliye, ya galat cheez ka naam boliye.',
    durationEditPrompt: 'Kitne din se dikkat hai? Naya samay boliye.',
    symptomEditPrompt: 'Mukhya lakshan dobara boliye.',
    emergencyAlert: 'Chetavni: Gambhir lakshan mile hain. Turant doctor ya PHC refer karein.',
    savedConfirm: 'Record encrypted roop se save ho gaya hai.',
    daysWord: 'din se',
    andWord: 'aur',
    confirmWord: 'Haan',
    declineWord: 'Nahi',
  },
  hinglish: {
    codeLabel: 'HI-EN',
    name: 'Hinglish',
    nativeScript: 'Hinglish',
    sublabel: 'Code-Mixed · Hindi + English',
    bcp47: 'hi-IN',
    whisperLang: 'hindi',
    consentPrompt: 'Kya main aapke symptoms record kar sakta hoon? Haan ya Nahi boliye.',
    consentDeclined: 'Theek hai, audio recording band hai. Tap-only mode on hai.',
    durationPrompt: 'Yeh problem kitne din se hai?',
    noiseRetryPrompt: 'Awaaz clear nahi aayi, phone paas laakar dobara boliye.',
    visualFallbackPrompt: 'Noise zyada hai, kripya neeche icons tap karein.',
    readbackPrefix: 'Maine suna:',
    readbackSuffix: 'Sahi hai toh Haan boliye, ya galat field ka naam boliye.',
    durationEditPrompt: 'Duration kitne din hai? Dobara boliye.',
    symptomEditPrompt: 'Main symptom dobara boliye.',
    emergencyAlert: 'Alert: Critical red flag mila hai. Patient ko turant doctor refer karein.',
    savedConfirm: 'Record offline encrypted queue mein save ho gaya hai.',
    daysWord: 'din se',
    andWord: 'aur',
    confirmWord: 'Haan',
    declineWord: 'Nahi',
  },
  bn: {
    codeLabel: 'BN',
    name: 'Bengali',
    nativeScript: 'বাংলা',
    sublabel: 'Bengali · বাংলায় লক্ষণ বলুন',
    bcp47: 'bn-IN',
    whisperLang: 'bengali',
    consentPrompt: 'Ami ki apnar lokkhon record korte pari? Haan ba Na bolun.',
    consentDeclined: 'Thik ache, recording bondho. Niche icon tap korun.',
    durationPrompt: 'Ei somosha koto din dhore hochhe?',
    noiseRetryPrompt: 'Awaaz porishkar noy, phone kache ene abar bolun.',
    visualFallbackPrompt: 'Onugroho kore nicher icon gulo beche nin.',
    readbackPrefix: 'Ami shunechi:',
    readbackSuffix: 'Thik thakle Haan bolun, na hole bhul ongsho bolun.',
    durationEditPrompt: 'Koto din dhore hochhe? Abar bolun.',
    symptomEditPrompt: 'Prodhan lokkhon abar bolun.',
    emergencyAlert: 'Sotorkota: Gurutero lokkhon pawa geche. Ekhoni daktarer kache refer korun.',
    savedConfirm: 'Record nirapod bhabe offline save hoyeche.',
    daysWord: 'din dhore',
    andWord: 'aar',
    confirmWord: 'Haan',
    declineWord: 'Na',
  },
};

export interface LexiconEntry {
  phrases: string[];
  canonical: string;
  snomedCode: string;
  snomedDisplay: string;
  en: string;
  spoken: Record<LanguageCode, string>;
  isRedFlag?: boolean;
  defaultSeverity?: SeverityGrade;
}

export const SYMPTOM_LEXICON: LexiconEntry[] = [
  {
    phrases: [
      'chhati bhari lag rahi hai',
      'chhati bhari lag rahi',
      'chhati mein bharipan',
      'chhati bhari',
      'buker bhetor chap lagche',
      'buker bhetor chap',
      'buke chap',
      'chest heaviness',
    ],
    canonical: 'chest_heaviness',
    snomedCode: '23924001',
    snomedDisplay: 'Tight chest / Cardiac heaviness',
    en: 'Chest Heaviness (Cardiac)',
    spoken: {
      hi: 'chhati mein bharipan',
      hinglish: 'chhati bhari lagna',
      bn: 'buker bhetor chap',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: [
      'haath pair sunn',
      'haath pa sunn',
      'hath pair sunn',
      'haat pa obosh',
      'limb numbness',
      'sunn ho rahe',
    ],
    canonical: 'limb_numbness',
    snomedCode: '44077006',
    snomedDisplay: 'Numbness of limb (Neurological)',
    en: 'Limb Numbness (Neuro)',
    spoken: {
      hi: 'haath pair sunn hona',
      hinglish: 'haath pair sunn',
      bn: 'haat pa obosh',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: [
      'aankhon ke aage andhera',
      'ankhon ke aage andhera',
      'chokher samne ondhokar',
      'blackout',
      'presyncope',
    ],
    canonical: 'presyncope_blackout',
    snomedCode: '271594007',
    snomedDisplay: 'Syncope / Presyncope blackout',
    en: 'Vision Blackout / Presyncope',
    spoken: {
      hi: 'aankhon ke aage andhera',
      hinglish: 'aankhon ke aage andhera',
      bn: 'chokher samne ondhokar',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['bachhe ko tez bukhar', 'bachhe ko bukhar', 'infant high fever', 'shishur jor'],
    canonical: 'infant_high_fever',
    snomedCode: '386661006',
    snomedDisplay: 'High fever in infant',
    en: 'Infant High Fever',
    spoken: {
      hi: 'bachhe ko tej bukhar',
      hinglish: 'bachhe ko tej bukhar',
      bn: 'shishur bhari jor',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: [
      'seene mein tez dard',
      'seene mein dard',
      'buke byatha',
      'chest pain',
    ],
    canonical: 'chest_pain',
    snomedCode: '29857009',
    snomedDisplay: 'Chest pain',
    en: 'Chest Pain',
    spoken: {
      hi: 'seene mein dard',
      hinglish: 'seene mein dard',
      bn: 'buke byatha',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['behoshi', 'behosh', 'unconscious', 'unconsciousness', 'gyan harano'],
    canonical: 'unconsciousness',
    snomedCode: '418107008',
    snomedDisplay: 'Unconsciousness',
    en: 'Unconsciousness',
    spoken: {
      hi: 'behoshi',
      hinglish: 'behoshi',
      bn: 'gyan harano',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['khoon behna', 'heavy bleeding', 'bahut khoon', 'rokto pora'],
    canonical: 'heavy_bleeding',
    snomedCode: '131148009',
    snomedDisplay: 'Hemorrhage / Heavy bleeding',
    en: 'Heavy Bleeding',
    spoken: {
      hi: 'bahut khoon behna',
      hinglish: 'heavy bleeding',
      bn: 'beshi rokto pora',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['daura', 'seizure', 'seizures', 'mirgi', 'khichuni'],
    canonical: 'seizures',
    snomedCode: '91175000',
    snomedDisplay: 'Seizure',
    en: 'Seizures',
    spoken: {
      hi: 'daura padna',
      hinglish: 'seizure',
      bn: 'khichuni',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['severe breathing trouble', 'saans lene mein bahut dikkat', 'saans ruk rahi'],
    canonical: 'severe_breathing_trouble',
    snomedCode: '267036007',
    snomedDisplay: 'Severe dyspnea',
    en: 'Severe Breathing Trouble',
    spoken: {
      hi: 'gambhir saans ki dikkat',
      hinglish: 'severe breathing trouble',
      bn: 'gurutero shash kosto',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: [
      'saans phoolna',
      'saans lene mein dikkat',
      'shash kosto',
      'shortness of breath',
    ],
    canonical: 'shortness_of_breath',
    snomedCode: '267036007',
    snomedDisplay: 'Dyspnea',
    en: 'Shortness of Breath',
    spoken: {
      hi: 'saans phoolna',
      hinglish: 'saans phoolna',
      bn: 'shash kosto',
    },
    isRedFlag: false,
    defaultSeverity: 'severe',
  },
  {
    phrases: ['tez bukhar', 'high fever', 'bhari jor', 'prochondo jor'],
    canonical: 'high_fever',
    snomedCode: '386661006',
    snomedDisplay: 'High fever',
    en: 'High Fever',
    spoken: {
      hi: 'tej bukhar',
      hinglish: 'tej bukhar',
      bn: 'bhari jor',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['bukhar', 'jor', 'fever'],
    canonical: 'fever',
    snomedCode: '386661006',
    snomedDisplay: 'Fever',
    en: 'Fever',
    spoken: {
      hi: 'bukhar',
      hinglish: 'bukhar',
      bn: 'jor',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['pet mein dard', 'pet dard', 'pete byatha', 'abdominal pain', 'stomach pain'],
    canonical: 'abdominal_pain',
    snomedCode: '21522001',
    snomedDisplay: 'Abdominal pain',
    en: 'Abdominal Pain',
    spoken: {
      hi: 'pet mein dard',
      hinglish: 'pet mein dard',
      bn: 'pete byatha',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['pet kharab', 'stomach upset', 'loose motion', 'dast', 'pet kharap'],
    canonical: 'stomach_upset',
    snomedCode: '62315008',
    snomedDisplay: 'Diarrhea / Stomach upset',
    en: 'Stomach Upset',
    spoken: {
      hi: 'pet kharab',
      hinglish: 'pet kharab',
      bn: 'pet kharap',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['chakkar aana', 'chakkar', 'matha ghora', 'dizziness'],
    canonical: 'dizziness',
    snomedCode: '404640003',
    snomedDisplay: 'Dizziness',
    en: 'Dizziness',
    spoken: {
      hi: 'chakkar aana',
      hinglish: 'chakkar aana',
      bn: 'matha ghora',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['sir dard', 'matha byatha', 'headache'],
    canonical: 'headache',
    snomedCode: '25064002',
    snomedDisplay: 'Headache',
    en: 'Headache',
    spoken: {
      hi: 'sir dard',
      hinglish: 'sir dard',
      bn: 'matha byatha',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['khansi', 'kashi', 'cough'],
    canonical: 'cough',
    snomedCode: '49727002',
    snomedDisplay: 'Cough',
    en: 'Cough',
    spoken: {
      hi: 'khansi',
      hinglish: 'khansi',
      bn: 'kashi',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
];

export const LEXICON_BY_CANONICAL: Record<string, LexiconEntry> = SYMPTOM_LEXICON.reduce(
  (acc, item) => {
    acc[item.canonical] = item;
    return acc;
  },
  {} as Record<string, LexiconEntry>
);

export function getSymptomDisplay(canonical: string, lang: LanguageCode = 'hinglish') {
  const entry = LEXICON_BY_CANONICAL[canonical];
  if (entry) {
    return {
      en: entry.en,
      spoken: entry.spoken[lang],
      snomedCode: entry.snomedCode,
      snomedDisplay: entry.snomedDisplay,
    };
  }
  return {
    en: 'General Weakness',
    spoken: lang === 'bn' ? 'durbolota' : 'kamzori',
    snomedCode: '367391008',
    snomedDisplay: 'Malaise',
  };
}

export const TEMPORAL_RESOLVED_PATTERN =
  /\b(utar\s+gaya|utargaya|theek\s+ho\s+gaya|thik\s+ho\s+gaya|khatam\s+ho\s+gaya|kam\s+ho\s+gaya|pehle\s+.*\btha\b.*\bab\s+nahi|kal\s+tha\s+ab\s+nahi|kal\s+chhilo\s+ekhon\s+nei|ekhon\s+nei|kome\s+geche|sere\s+geche|broke\s+yesterday|resolved)\b/i;

export const EXPLICIT_NEGATION_PATTERN =
  /\b(nahi\s+hai|nahi|na\s+hai|nei|na\b|no\s+fever|without|nathi)\b/i;

export interface MedicationEntry {
  canonical: string;
  display: string;
  aliases: string[];
}

export const MEDICATION_LEXICON: MedicationEntry[] = [
  { canonical: 'paracetamol', display: 'Paracetamol', aliases: ['paracetamol', 'pcm'] },
  { canonical: 'dolo', display: 'Dolo', aliases: ['dolo', 'dolo 650'] },
  { canonical: 'crocin', display: 'Crocin', aliases: ['crocin'] },
  { canonical: 'ors', display: 'ORS', aliases: ['ors', 'electral', 'jeevan jal'] },
  { canonical: 'antibiotic', display: 'Antibiotic', aliases: ['antibiotic', 'azithromycin', 'amoxicillin'] },
  { canonical: 'insulin', display: 'Insulin', aliases: ['insulin'] },
  { canonical: 'aspirin', display: 'Aspirin', aliases: ['aspirin', 'ecosprin'] },
];
