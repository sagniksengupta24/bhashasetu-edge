// src/slu/normalize.ts
// Zero-dependency Unicode NFC normalizer, Devanagari/Bengali-to-canonical-Latin transliterator,
// digit normalizer, and phonetic variant canonicalizer.

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
};

const DEVANAGARI_NUKTA_MAP: Record<string, string> = {
  'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f',
};

const DEVANAGARI_VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
};

const DEVANAGARI_MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const BENGALI_CONSONANTS: Record<string, string> = {
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'ny',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh', 'য়': 'y', 'ৎ': 't',
};

const BENGALI_NUKTA_MAP: Record<string, string> = {
  'ড': 'r', 'ঢ': 'rh', 'য': 'y',
};

const BENGALI_VOWELS: Record<string, string> = {
  'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'ee', 'উ': 'u', 'ঊ': 'oo',
  'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
};

const BENGALI_MATRAS: Record<string, string> = {
  'া': 'a', 'ি': 'i', 'ী': 'ee', 'ু': 'u', 'ূ': 'oo',
  'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou',
};

const DIGIT_MAP: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
};

function isWordEnd(chars: string[], idx: number): boolean {
  if (idx >= chars.length) return true;
  const next = chars[idx];
  return /[\s,.;:!?()\-/]/.test(next);
}

function transliterateDevanagariAndBengali(input: string): string {
  const chars = Array.from(input);
  const out: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (DIGIT_MAP[ch]) {
      out.push(DIGIT_MAP[ch]);
      continue;
    }

    // Devanagari independent vowels
    if (DEVANAGARI_VOWELS[ch]) {
      out.push(DEVANAGARI_VOWELS[ch]);
      continue;
    }

    // Bengali independent vowels
    if (BENGALI_VOWELS[ch]) {
      out.push(BENGALI_VOWELS[ch]);
      continue;
    }

    // Devanagari consonants
    if (DEVANAGARI_CONSONANTS[ch]) {
      let base = DEVANAGARI_CONSONANTS[ch];
      let nextIdx = i + 1;
      if (chars[nextIdx] === '\u093C') {
        // Nukta
        base = DEVANAGARI_NUKTA_MAP[ch] ?? base;
        nextIdx++;
        i++;
      }
      const next = chars[nextIdx];
      if (next === '\u094D') {
        // Halant: suppress inherent vowel
        out.push(base);
        i++;
      } else if (next && DEVANAGARI_MATRAS[next]) {
        out.push(base + DEVANAGARI_MATRAS[next]);
        i++;
      } else if (next === '\u0902' || next === '\u0901') {
        // Anusvara / Chandrabindu
        out.push(base + 'a' + 'n');
        i++;
      } else if (isWordEnd(chars, nextIdx)) {
        // Hindi schwa deletion at word boundary
        out.push(base);
      } else {
        out.push(base + 'a');
      }
      continue;
    }

    // Bengali consonants
    if (BENGALI_CONSONANTS[ch]) {
      let base = BENGALI_CONSONANTS[ch];
      let nextIdx = i + 1;
      if (chars[nextIdx] === '\u09BC') {
        // Bengali nukta
        base = BENGALI_NUKTA_MAP[ch] ?? base;
        nextIdx++;
        i++;
      }
      const next = chars[nextIdx];
      if (next === '\u09CD') {
        // Hasanta: suppress inherent vowel
        out.push(base);
        i++;
        // Handle ব-ফলা (e.g., জ্বর -> j+w+or)
        if (chars[i + 1] === 'ব' && i + 1 < chars.length) {
          out.push('w');
          const afterBa = chars[i + 2];
          if (afterBa && BENGALI_MATRAS[afterBa]) {
            out.push(BENGALI_MATRAS[afterBa]);
            i += 2;
          } else if (afterBa === '\u09CD') {
            i += 2;
          } else if (!isWordEnd(chars, i + 2)) {
            out.push('o');
            i += 1;
          } else {
            i += 1;
          }
        } else if (chars[i + 1] === 'য' && i + 1 < chars.length) {
          // Handle য-ফলা (e.g., ব্যথা -> b+ya+th+a)
          out.push('y');
          const afterJa = chars[i + 2];
          if (afterJa && BENGALI_MATRAS[afterJa]) {
            out.push(BENGALI_MATRAS[afterJa]);
            i += 2;
          } else if (!isWordEnd(chars, i + 2)) {
            out.push('a');
            i += 1;
          } else {
            i += 1;
          }
        }
      } else if (next && BENGALI_MATRAS[next]) {
        out.push(base + BENGALI_MATRAS[next]);
        i++;
      } else if (next === '\u0982' || next === '\u0981') {
        out.push(base + 'o' + 'n');
        i++;
      } else if (isWordEnd(chars, nextIdx) || ch === 'ৎ') {
        out.push(base);
      } else {
        out.push(base + 'o');
      }
      continue;
    }

    // Standalone nasalization / visarga
    if (ch === '\u0902' || ch === '\u0901' || ch === '\u0982' || ch === '\u0981') {
      out.push('n');
      continue;
    }
    if (ch === '\u0903' || ch === '\u0983') {
      out.push('h');
      continue;
    }
    if (ch === '।' || ch === '॥') {
      out.push('.');
      continue;
    }

    out.push(ch);
  }

  return out.join('');
}

const PHONETIC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(bhukar|bookhar|bukhaar|bukhaara)\b/g, 'bukhar'],
  [/\b(jwor|jwar|jbor|jor)\b/g, 'jor'],
  [/\b(sine|seene|cheene|sinee)\b/g, 'seene'],
  [/\b(chhaatee|chhaati|chhati|chaati)\b/g, 'chhati'],
  [/\b(bhaaree|bhaari|bhari)\b/g, 'bhari'],
  [/\b(naheen|nahin|nahi)\b/g, 'nahi'],
  [/\b(gayaa|gaya)\b/g, 'gaya'],
  [/\b(thaa|tha)\b/g, 'tha'],
  [/\b(rahee|rahi)\b/g, 'rahi'],
  [/\b(men|mein|me)\b/g, 'mein'],
  [/\b(teez|tez|tej)\b/g, 'tez'],
  [/\b(mareez|mariz|marij)\b/g, 'mareez'],
  [/\b(buke|buker)\b/g, '$1'],
  [/\b(byatha|betha|bytha|bjtha|bjatha)\b/g, 'byatha'],
  [/\b(kintu|keentu)\b/g, 'kintu'],
  [/\b(ekhon|ekhan)\b/g, 'ekhon'],
  [/\b(shash|shwash|shasho)\b/g, 'shash'],
  [/\b(kosto|koshto)\b/g, 'kosto'],
  [/\b(shashkosto|shwashkosto|shwashkoshto|shwasokosht|shwasokoshto|shwaskosht)\b/g, 'shash kosto'],
  [/\b(chhilo|chilo)\b/g, 'chhilo'],
  [/\b(ultee|ulti)\b/g, 'ulti'],
  [/\b(khaansee|khaansi|khansi|khansee)\b/g, 'khansi'],
  [/\b(kaashee|kaashi|kashi)\b/g, 'kashi'],
  [/\b(jwala|jala)\b/g, 'jala'],
  [/\b(jondis|jondish)\b/g, 'jaundice'],
  [/\b(soojan|sujan|soojon)\b/g, 'soojan'],
  [/\b(peeliya|piliya|peelia)\b/g, 'peeliya'],
  [/\b(zukam|jukaam|jukam)\b/g, 'zukam'],
  [/\b(hyan|haan|haann)\b/g, 'haan'],
];

/**
 * Normalizes a trilingual clinical utterance:
 * 1. Unicode NFC + lowercase
 * 2. Deterministic Devanagari & Bengali -> Latin transliteration + digit conversion
 * 3. Canonical phonetic variant normalization
 */
export function normalizeTranscript(rawText: string): string {
  const nfc = rawText.normalize('NFC').trim().toLowerCase();
  if (!nfc) return '';

  let latin = transliterateDevanagariAndBengali(nfc);
  for (const [pattern, replacement] of PHONETIC_REPLACEMENTS) {
    latin = latin.replace(pattern, replacement);
  }
  return latin.replace(/\s+/g, ' ').trim();
}
