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
    consentPrompt: 'क्या मैं आपके लक्षण रिकॉर्ड कर सकता हूँ? हाँ या नहीं बोलिए।',
    consentDeclined: 'ठीक है, रिकॉर्डिंग बंद है। आप नीचे आइकन चुन सकते हैं।',
    durationPrompt: 'यह दिक्कत कितने दिन से है?',
    noiseRetryPrompt: 'लक्षण स्पष्ट नहीं मिला, फ़ोन पास लाकर फिर बोलिए।',
    visualFallbackPrompt: 'कृपया नीचे दिए गए आइकन चुनें।',
    readbackPrefix: 'मैंने सुना:',
    readbackSuffix: 'सही है तो हाँ बोलिए, या गलत जानकारी का नाम बोलिए।',
    durationEditPrompt: 'कितने दिन से दिक्कत है? नया समय बोलिए।',
    symptomEditPrompt: 'मुख्य लक्षण दोबारा बोलिए।',
    emergencyAlert: 'चेतावनी: गंभीर लक्षण मिले हैं। तुरंत डॉक्टर या पीएचसी रेफर करें।',
    savedConfirm: 'रिकॉर्ड सुरक्षित रूप से सेव हो गया है।',
    daysWord: 'दिन से',
    andWord: 'और',
    confirmWord: 'हाँ',
    declineWord: 'नहीं',
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
    noiseRetryPrompt: 'Symptom clear nahi mila, phone paas laakar dobara boliye.',
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
    consentPrompt: 'আমি কি আপনার লক্ষণ রেকর্ড করতে পারি? হ্যাঁ বা না বলুন।',
    consentDeclined: 'ঠিক আছে, রেকর্ডিং বন্ধ। নিচে আইকন ট্যাপ করুন।',
    durationPrompt: 'এই সমস্যা কত দিন ধরে হচ্ছে?',
    noiseRetryPrompt: 'লক্ষণ স্পষ্ট বোঝা যায়নি, ফোন কাছে এনে আবার বলুন।',
    visualFallbackPrompt: 'অনুগ্রহ করে নিচের আইকনগুলো বেছে নিন।',
    readbackPrefix: 'আমি শুনেছি:',
    readbackSuffix: 'ঠিক থাকলে হ্যাঁ বলুন, না হলে ভুল অংশটি বলুন।',
    durationEditPrompt: 'কত দিন ধরে হচ্ছে? আবার বলুন।',
    symptomEditPrompt: 'প্রধান লক্ষণ আবার বলুন।',
    emergencyAlert: 'সতর্কতা: গুরুতর লক্ষণ পাওয়া গেছে। এখনই ডাক্তারের কাছে রেফার করুন।',
    savedConfirm: 'রেকর্ড নিরাপদভাবে অফলাইনে সেভ হয়েছে।',
    daysWord: 'দিন ধরে',
    andWord: 'এবং',
    confirmWord: 'হ্যাঁ',
    declineWord: 'না',
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
      hi: 'छाती में भारीपन',
      hinglish: 'chhati bhari lagna',
      bn: 'বুকের ভেতর চাপ',
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
      hi: 'हाथ पैर सुन्न होना',
      hinglish: 'haath pair sunn',
      bn: 'হাত পা অবশ',
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
      hi: 'आँखों के आगे अँधेरा',
      hinglish: 'aankhon ke aage andhera',
      bn: 'চোখের সামনে অন্ধকার',
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
      hi: 'बच्चे को तेज़ बुखार',
      hinglish: 'bachhe ko tej bukhar',
      bn: 'শিশুর ভারী জ্বর',
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
      hi: 'सीने में दर्द',
      hinglish: 'seene mein dard',
      bn: 'বুকে ব্যথা',
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
      hi: 'बेहोशी',
      hinglish: 'behoshi',
      bn: 'জ্ঞান হারানো',
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
      hi: 'बहुत खून बहना',
      hinglish: 'heavy bleeding',
      bn: 'বেশি রক্ত পড়া',
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
      hi: 'दौरा पड़ना',
      hinglish: 'seizure',
      bn: 'খিঁচুনি',
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
      hi: 'गंभीर साँस की दिक्कत',
      hinglish: 'severe breathing trouble',
      bn: 'গুরুতর শ্বাসকষ্ট',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: [
      'saans phoolna',
      'saans lene mein dikkat',
      'shash kosto',
      'shashkosto',
      'shortness of breath',
    ],
    canonical: 'shortness_of_breath',
    snomedCode: '267036007',
    snomedDisplay: 'Dyspnea',
    en: 'Shortness of Breath',
    spoken: {
      hi: 'साँस फूलना',
      hinglish: 'saans phoolna',
      bn: 'শ্বাসকষ্ট',
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
      hi: 'तेज़ बुखार',
      hinglish: 'tej bukhar',
      bn: 'ভারী জ্বর',
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
      hi: 'बुखार',
      hinglish: 'bukhar',
      bn: 'জ্বর',
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
      hi: 'पेट में दर्द',
      hinglish: 'pet mein dard',
      bn: 'পেটে ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['patla dast', 'patla paykhana', 'diarrhea', 'diarrhoea'],
    canonical: 'diarrhea',
    snomedCode: '62315008',
    snomedDisplay: 'Diarrhea',
    en: 'Diarrhea',
    spoken: {
      hi: 'पतले दस्त',
      hinglish: 'patla dast',
      bn: 'পাতলা পায়খানা',
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
      hi: 'पेट खराब',
      hinglish: 'pet kharab',
      bn: 'পেট খারাপ',
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
      hi: 'चक्कर आना',
      hinglish: 'chakkar aana',
      bn: 'মাথা ঘোরা',
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
      hi: 'सिर दर्द',
      hinglish: 'sir dard',
      bn: 'মাথা ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['khansi mein khoon', 'kashir sathe rokto', 'coughing blood', 'hemoptysis'],
    canonical: 'hemoptysis',
    snomedCode: '66857006',
    snomedDisplay: 'Hemoptysis',
    en: 'Coughing Blood',
    spoken: {
      hi: 'खांसी में खून आना',
      hinglish: 'khansi mein khoon',
      bn: 'কাশির সাথে রক্ত পড়া',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['sukhi khansi', 'shukno kashi', 'dry cough'],
    canonical: 'dry_cough',
    snomedCode: '11833005',
    snomedDisplay: 'Dry cough',
    en: 'Dry Cough',
    spoken: {
      hi: 'सूखी खांसी',
      hinglish: 'sukhi khansi',
      bn: 'শুকনো কাশি',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['balgam wali khansi', 'balgam', 'kof soho kashi', 'kof', 'productive cough', 'wet cough'],
    canonical: 'productive_cough',
    snomedCode: '28743005',
    snomedDisplay: 'Productive cough',
    en: 'Productive Cough (Phlegm)',
    spoken: {
      hi: 'बलगम वाली खांसी',
      hinglish: 'balgam wali khansi',
      bn: 'কফ সহ কাশি',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['khansi', 'kashi', 'cough'],
    canonical: 'cough',
    snomedCode: '49727002',
    snomedDisplay: 'Cough',
    en: 'Cough',
    spoken: {
      hi: 'खांसी',
      hinglish: 'khansi',
      bn: 'কাশি',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['kamzori', 'durbolota', 'weakness', 'thakan', 'klanti', 'fatigue', 'tiredness'],
    canonical: 'general_malaise',
    snomedCode: '367391008',
    snomedDisplay: 'Malaise',
    en: 'General Weakness / Fatigue',
    spoken: {
      hi: 'कमज़ोरी',
      hinglish: 'kamzori',
      bn: 'দুর্বলতা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['badan dard', 'sharir dard', 'gaa byatha', 'body ache', 'body pain', 'myalgia'],
    canonical: 'body_ache',
    snomedCode: '68962001',
    snomedDisplay: 'Myalgia / Body ache',
    en: 'Body Ache',
    spoken: {
      hi: 'बदन दर्द',
      hinglish: 'badan dard',
      bn: 'গা ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['jodon mein dard', 'jodon ka dard', 'ginte byatha', 'hantu byatha', 'joint pain', 'knee pain'],
    canonical: 'joint_pain',
    snomedCode: '57676002',
    snomedDisplay: 'Arthralgia / Joint pain',
    en: 'Joint Pain',
    spoken: {
      hi: 'जोड़ों में दर्द',
      hinglish: 'jodon mein dard',
      bn: 'গাঁটে ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['kamar dard', 'peeth dard', 'komore byatha', 'pith byatha', 'back pain', 'lower back pain'],
    canonical: 'back_pain',
    snomedCode: '161891005',
    snomedDisplay: 'Backache',
    en: 'Back Pain',
    spoken: {
      hi: 'कमर दर्द',
      hinglish: 'kamar dard',
      bn: 'কোমরে ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['gardan dard', 'ghare byatha', 'neck pain'],
    canonical: 'neck_pain',
    snomedCode: '81680005',
    snomedDisplay: 'Neck pain',
    en: 'Neck Pain',
    spoken: {
      hi: 'गर्दन दर्द',
      hinglish: 'gardan dard',
      bn: 'ঘাড়ে ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['ulti', 'bomi', 'vomiting', 'vomit'],
    canonical: 'vomiting',
    snomedCode: '422400008',
    snomedDisplay: 'Vomiting',
    en: 'Vomiting',
    spoken: {
      hi: 'उल्टी',
      hinglish: 'ulti',
      bn: 'বমি',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['ji machlana', 'matli', 'bomi bhab', 'gaa golano', 'nausea'],
    canonical: 'nausea',
    snomedCode: '422587007',
    snomedDisplay: 'Nausea',
    en: 'Nausea',
    spoken: {
      hi: 'जी मिचलाना',
      hinglish: 'ji machlana',
      bn: 'বমি ভাব',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['kabz', 'koshtho kathinyo', 'constipation'],
    canonical: 'constipation',
    snomedCode: '14760008',
    snomedDisplay: 'Constipation',
    en: 'Constipation',
    spoken: {
      hi: 'कब्ज़',
      hinglish: 'kabz',
      bn: 'কোষ্ঠকাঠিন্য',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['acidity', 'gas', 'buke jala', 'seene mein jalan', 'heartburn', 'gastric'],
    canonical: 'acidity',
    snomedCode: '16331000',
    snomedDisplay: 'Heartburn / Acidity',
    en: 'Acidity / Heartburn',
    spoken: {
      hi: 'एसिडिटी और जलन',
      hinglish: 'acidity',
      bn: 'অম্বল ও বুক জ্বালা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['bhookh na lagna', 'bhookh nahi', 'khide nei', 'loss of appetite'],
    canonical: 'loss_of_appetite',
    snomedCode: '79890006',
    snomedDisplay: 'Loss of appetite',
    en: 'Loss of Appetite',
    spoken: {
      hi: 'भूख न लगना',
      hinglish: 'bhookh na lagna',
      bn: 'খিদে না পাওয়া',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['gale mein kharash', 'gale mein dard', 'gala dard', 'golay byatha', 'sore throat', 'throat pain'],
    canonical: 'sore_throat',
    snomedCode: '162397003',
    snomedDisplay: 'Sore throat',
    en: 'Sore Throat',
    spoken: {
      hi: 'गले में दर्द',
      hinglish: 'gale mein dard',
      bn: 'গলায় ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['naak behna', 'zukam', 'sardi', 'sordi', 'nak diye jol', 'runny nose', 'cold'],
    canonical: 'runny_nose',
    snomedCode: '64531003',
    snomedDisplay: 'Nasal discharge / Coryza',
    en: 'Cold / Runny Nose',
    spoken: {
      hi: 'ज़ुकाम और नाक बहना',
      hinglish: 'sardi zukam',
      bn: 'সর্দি ও নাক দিয়ে জল পড়া',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['kaan mein dard', 'kaan dard', 'kane byatha', 'ear pain', 'earache'],
    canonical: 'ear_pain',
    snomedCode: '16001004',
    snomedDisplay: 'Otalgia / Ear pain',
    en: 'Ear Pain',
    spoken: {
      hi: 'कान में दर्द',
      hinglish: 'kaan mein dard',
      bn: 'কানে ব্যথা',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['thand lagna', 'kampan', 'kaanpuni', 'chills', 'shivering'],
    canonical: 'chills',
    snomedCode: '43724002',
    snomedDisplay: 'Chills',
    en: 'Chills / Rigors',
    spoken: {
      hi: 'ठंड लगना और कंपकंपी',
      hinglish: 'thand lagna',
      bn: 'কাঁপুনি দিয়ে ঠান্ডা লাগা',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['peshab mein jalan', 'peshab jalan', 'proshrabe jala', 'burning urination', 'uti'],
    canonical: 'burning_urination',
    snomedCode: '49650001',
    snomedDisplay: 'Dysuria',
    en: 'Burning Urination',
    spoken: {
      hi: 'पेशाब में जलन',
      hinglish: 'peshab mein jalan',
      bn: 'প্রস্রাবে জ্বালা',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['khujli', 'daane', 'chulkani', 'skin rash', 'rash', 'itching'],
    canonical: 'skin_rash',
    snomedCode: '271807003',
    snomedDisplay: 'Skin rash',
    en: 'Skin Rash / Itching',
    spoken: {
      hi: 'खुजली और दाने',
      hinglish: 'khujli aur rash',
      bn: 'চুলকানি ও র‍্যাশ',
    },
    isRedFlag: false,
    defaultSeverity: 'mild',
  },
  {
    phrases: ['soojan', 'sujan', 'fula', 'swelling', 'edema'],
    canonical: 'swelling',
    snomedCode: '65124004',
    snomedDisplay: 'Swelling / Edema',
    en: 'Swelling / Edema',
    spoken: {
      hi: 'सूजन',
      hinglish: 'soojan',
      bn: 'ফোলা ভাব',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['peeliya', 'piliya', 'jaundice', 'chokh holud', 'aankh peeli'],
    canonical: 'jaundice',
    snomedCode: '18165001',
    snomedDisplay: 'Jaundice',
    en: 'Jaundice',
    spoken: {
      hi: 'पीलिया',
      hinglish: 'peeliya',
      bn: 'জন্ডিস',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['dhundhla dikhna', 'chokhe jhapsha', 'blurred vision'],
    canonical: 'blurred_vision',
    snomedCode: '246636008',
    snomedDisplay: 'Blurred vision',
    en: 'Blurred Vision',
    spoken: {
      hi: 'धुंधला दिखना',
      hinglish: 'dhundhla dikhna',
      bn: 'চোখে ঝাপসা দেখা',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['dil tez dhadakna', 'dhadkan tez', 'buke dhorforani', 'palpitations'],
    canonical: 'palpitations',
    snomedCode: '80313002',
    snomedDisplay: 'Palpitations',
    en: 'Palpitations',
    spoken: {
      hi: 'दिल तेज़ धड़कना',
      hinglish: 'dil tez dhadakna',
      bn: 'বুক ধড়ফড় করা',
    },
    isRedFlag: false,
    defaultSeverity: 'moderate',
  },
  {
    phrases: ['latrine mein khoon', 'paykhanay rokto', 'blood in stool', 'melena'],
    canonical: 'blood_in_stool',
    snomedCode: '405729008',
    snomedDisplay: 'Hematochezia / Blood in stool',
    en: 'Blood in Stool',
    spoken: {
      hi: 'मल में खून आना',
      hinglish: 'blood in stool',
      bn: 'পায়খানায় রক্ত পড়া',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
  },
  {
    phrases: ['awaaz ladkhadana', 'bolne mein dikkat', 'kotha joriye jawa', 'slurred speech'],
    canonical: 'slurred_speech',
    snomedCode: '289195008',
    snomedDisplay: 'Dysarthria / Slurred speech',
    en: 'Slurred Speech (Neuro)',
    spoken: {
      hi: 'बोलने में लड़खड़ाहट',
      hinglish: 'slurred speech',
      bn: 'কথা জড়িয়ে যাওয়া',
    },
    isRedFlag: true,
    defaultSeverity: 'critical_red_flag',
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
    en: 'No Symptom Detected',
    spoken:
      lang === 'bn'
        ? 'কোনো লক্ষণ পাওয়া যায়নি'
        : lang === 'hi'
        ? 'कोई लक्षण नहीं मिला'
        : 'Koi lakshan nahi mila',
    snomedCode: '404684003',
    snomedDisplay: 'Clinical finding',
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
