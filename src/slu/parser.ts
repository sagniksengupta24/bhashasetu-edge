// src/slu/parser.ts
// Clause-level trilingual SLU engine with native-script normalization,
// word-boundary medication/unit extraction, strict per-clause negation scoping,
// red-flag safety preservation under low confidence, and coarse-dated FHIR R4 builder.

import { exactTokenPhraseMatch, fuzzyPhraseMatch } from './fuzzy';
import { normalizeTranscript } from './normalize';
import {
  type ClinicalSlots,
  EXPLICIT_NEGATION_PATTERN,
  getSymptomDisplay,
  type LanguageCode,
  MEDICATION_LEXICON,
  type SeverityGrade,
  SYMPTOM_LEXICON,
  TEMPORAL_RESOLVED_PATTERN,
} from './schema';

export interface ParseResult {
  slots: ClinicalSlots;
  lowConfidenceFields: string[];
  redFlagsTriggered: string[];
  normalizedTokens: string[];
  normalizedText: string;
}

const WORD_NUMBER_MAP: Record<string, number> = {
  aaj: 1,
  today: 1,
  ek: 1,
  one: 1,
  do: 2,
  dui: 2,
  two: 2,
  teen: 3,
  tin: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  paanch: 5,
  panch: 5,
  five: 5,
  chhe: 6,
  chhah: 6,
  choy: 6,
  chhoy: 6,
  six: 6,
  saat: 7,
  sat: 7,
  seven: 7,
  aath: 8,
  aat: 8,
  at: 8,
  eight: 8,
  nau: 9,
  noy: 9,
  nine: 9,
  das: 10,
  dosh: 10,
  ten: 10,
};

export function extractDurationDays(rawText: string): number | null {
  const normalized = normalizeTranscript(rawText);
  if (!normalized) return null;

  // Strip resolved-history phrases like "kal utar gaya" so "kal" isn't confused
  const cleaned = normalized
    .replace(/\bkal\s+(utar\s+gaya|theek\s+ho\s+gaya|chhilo|kome\s+geche)\b/gi, '')
    .trim();

  // Months (x30)
  const monthNum = cleaned.match(
    /\b(\d+)\s*(mahina|mahine|maheenaa?|maheene|months?|maash|mash|mas)\b/i
  );
  if (monthNum) return parseInt(monthNum[1], 10) * 30;
  const monthWord = cleaned.match(
    /\b(ek|do|dui|teen|tin|char|chaar|paanch|panch|one|two|three)\s+(mahina|mahine|maheenaa?|maheene|months?|maash|mash|mas)\b/i
  );
  if (monthWord) {
    const val = WORD_NUMBER_MAP[monthWord[1].toLowerCase()];
    if (val) return val * 30;
  }

  // Weeks (x7)
  const weekNum = cleaned.match(
    /\b(\d+)\s*(haftaa?|hafte|haphtaa?|haphte|weeks?|saptah|soptaho|soptah|shopta)\b/i
  );
  if (weekNum) return parseInt(weekNum[1], 10) * 7;
  const weekWord = cleaned.match(
    /\b(ek|do|dui|teen|tin|char|chaar|paanch|panch|one|two|three)\s+(haftaa?|hafte|haphtaa?|haphte|weeks?|saptah|soptaho|soptah|shopta)\b/i
  );
  if (weekWord) {
    const val = WORD_NUMBER_MAP[weekWord[1].toLowerCase()];
    if (val) return val * 7;
  }

  // Days (x1)
  const dayNum = cleaned.match(/\b(\d+)\s*(din|dino|dinon|days?|diner)\b/i);
  if (dayNum) return parseInt(dayNum[1], 10);
  const dayWord = cleaned.match(
    /\b(aaj|today|ek|one|do|dui|two|teen|tin|three|char|chaar|four|paanch|panch|five|chhe|chhah|choy|chhoy|six|saat|sat|seven|aath|aat|at|eight|nau|noy|nine|das|dosh|ten)\s+(din|dino|dinon|days?|diner)\b/i
  );
  if (dayWord) {
    const val = WORD_NUMBER_MAP[dayWord[1].toLowerCase()];
    if (val) return val;
  }

  // Short standalone reply (e.g. "teen" or "3")
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4) {
    for (const tok of tokens) {
      const lowerTok = tok.toLowerCase();
      if (WORD_NUMBER_MAP[lowerTok] !== undefined) {
        return WORD_NUMBER_MAP[lowerTok];
      }
      if (/^\d{1,2}$/.test(lowerTok)) {
        return parseInt(lowerTok, 10);
      }
    }
  }

  return null;
}

function extractTemperature(normalized: string): string | null {
  // Celsius e.g. "39 C", "38.5°C", "temp 39 celsius"
  const cMatch = normalized.match(
    /\b(3[5-9](?:\.\d)?|4[0-2](?:\.\d)?)\s*°?\s*(?:c|celsius|centigrade)\b/i
  );
  if (cMatch) {
    const cVal = parseFloat(cMatch[1]);
    const fVal = (cVal * 9) / 5 + 32;
    return `${fVal.toFixed(1)}°F (${cVal}°C)`;
  }

  // Fahrenheit e.g. "102 F", "101.4°F", "bukhar 102"
  const fExplicit = normalized.match(
    /\b(9[5-9](?:\.\d)?|10[0-8](?:\.\d)?)\s*°?\s*(?:f|fahrenheit)\b/i
  );
  if (fExplicit) {
    return `${fExplicit[1]}°F`;
  }

  const tempContext = normalized.match(
    /\b(?:temp|temperature|bukhar|jor|fever)\s*[:\-]?\s*(9[5-9](?:\.\d)?|10[0-8](?:\.\d)?)\b/i
  );
  if (tempContext) {
    return `${tempContext[1]}°F`;
  }

  return null;
}

export function parseClinicalUtterance(
  rawText: string,
  options?: {
    snrDb?: number;
    overrideConfidence?: number;
    lowConfidenceFields?: string[];
  }
): ParseResult {
  const normalizedFull = normalizeTranscript(rawText);
  const activeSymptoms: string[] = [];
  const resolvedSymptoms: string[] = [];
  const negatedSymptoms: string[] = [];
  const redFlagsTriggered: string[] = [];
  const normalizedTokens: string[] = [];

  let highestSeverity: SeverityGrade = 'mild';
  const severityRank: Record<SeverityGrade, number> = {
    mild: 1,
    moderate: 2,
    severe: 3,
    critical_red_flag: 4,
  };

  // Split into clauses on punctuation and contrast/temporal boundaries.
  // Keep "ab nahi", "ekhon nei", and "kal utar gaya" inside their owning clause.
  const rawClauses = normalizedFull
    .split(/[,;.!?]+|\b(?:par|lekin|magar|but|kintu|ab\s+bas|sirf|shudhu)\b|\bab\b(?!\s+nahi)/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const clauses = rawClauses.length > 0 ? rawClauses : [normalizedFull];

  for (const clause of clauses) {
    const lowerClause = clause.toLowerCase();
    const isTemporalResolved = TEMPORAL_RESOLVED_PATTERN.test(lowerClause);
    const isExplicitlyNegated = !isTemporalResolved && EXPLICIT_NEGATION_PATTERN.test(lowerClause);
    const matchedRanges: Array<[number, number]> = [];

    for (const entry of SYMPTOM_LEXICON) {
      for (const phrase of entry.phrases) {
        const match = fuzzyPhraseMatch(lowerClause, phrase);
        if (match) {
          const { start: idx, end: endIdx, isFuzzy } = match;
          const overlaps = matchedRanges.some(
            ([s, e]) => (idx >= s && idx < e) || (endIdx > s && endIdx <= e)
          );
          if (overlaps) continue;
          matchedRanges.push([idx, endIdx]);

          if (isTemporalResolved) {
            if (!resolvedSymptoms.includes(entry.canonical)) {
              resolvedSymptoms.push(entry.canonical);
              normalizedTokens.push(`resolved:${entry.canonical}`);
            }
          } else if (isExplicitlyNegated) {
            if (!negatedSymptoms.includes(entry.canonical)) {
              negatedSymptoms.push(entry.canonical);
              normalizedTokens.push(`!${entry.canonical}`);
            }
          } else {
            if (!activeSymptoms.includes(entry.canonical)) {
              activeSymptoms.push(entry.canonical);
              normalizedTokens.push(
                `${phrase}${isFuzzy ? '≈' : ''} → ${entry.canonical}`
              );
            }
            if (entry.isRedFlag && !redFlagsTriggered.includes(entry.canonical)) {
              redFlagsTriggered.push(entry.canonical);
            }
            const candSev = entry.defaultSeverity || 'mild';
            if (severityRank[candSev] > severityRank[highestSeverity]) {
              highestSeverity = candSev;
            }
          }
          break;
        }
      }
    }
  }

  let durationDays = extractDurationDays(rawText);
  if (durationDays !== null) normalizedTokens.push(`duration:${durationDays}d`);

  let bp: string | null = null;
  const bpMatch = normalizedFull.match(/\bbp\s*[:\-]?\s*(\d{2,3}\s*\/\s*\d{2,3})\b/i);
  if (bpMatch) {
    bp = `${bpMatch[1].replace(/\s+/g, '')} mmHg`;
    normalizedTokens.push(`BP:${bp}`);
  }

  const temperature = extractTemperature(normalizedFull);
  if (temperature) {
    normalizedTokens.push(`Temp:${temperature}`);
  }

  let sugar: string | null = null;
  const sugarValMatch = normalizedFull.match(/\bsugar\s*[:\-]?\s*(\d{2,3})\b/i);
  if (sugarValMatch) {
    sugar = `${sugarValMatch[1]} mg/dL`;
    normalizedTokens.push(`Sugar:${sugar}`);
  } else if (exactTokenPhraseMatch(normalizedFull, 'sugar')) {
    sugar = 'Reported';
    normalizedTokens.push('Sugar:Reported');
  }

  const medications: string[] = [];
  for (const med of MEDICATION_LEXICON) {
    if (med.aliases.some((alias) => exactTokenPhraseMatch(normalizedFull, alias))) {
      medications.push(med.display);
      normalizedTokens.push(`Med:${med.canonical}`);
    }
  }

  if (redFlagsTriggered.length > 0) {
    highestSeverity = 'critical_red_flag';
    if (durationDays === null) durationDays = 1;
  } else if (activeSymptoms.length >= 2 && severityRank[highestSeverity] < severityRank['moderate']) {
    highestSeverity = 'moderate';
  }

  const severityByCanonical = new Map<string, SeverityGrade>(
    SYMPTOM_LEXICON.map((e) => [e.canonical, e.defaultSeverity || 'mild'])
  );
  activeSymptoms.sort(
    (a, b) =>
      severityRank[severityByCanonical.get(b) || 'mild'] -
      severityRank[severityByCanonical.get(a) || 'mild']
  );

  const primarySymptom = activeSymptoms[0] || 'none';
  const secondarySymptoms = activeSymptoms.slice(1);

  const snr = options?.snrDb ?? 18;
  let computedConf = 0.62;
  if (activeSymptoms.length > 0) computedConf += 0.22;
  if (durationDays !== null) computedConf += 0.08;
  if (snr >= 15) computedConf += 0.05;
  else if (snr < 8) computedConf -= 0.14;
  if (normalizedFull.split(/\s+/).filter(Boolean).length < 2) computedConf -= 0.1;
  computedConf = Math.max(0.45, Math.min(0.98, Number(computedConf.toFixed(2))));

  const confidenceScore =
    options?.overrideConfidence !== undefined ? options.overrideConfidence : computedConf;

  const lowConfidenceFields =
    options?.lowConfidenceFields !== undefined
      ? options.lowConfidenceFields
      : confidenceScore < 0.85
      ? activeSymptoms.length === 0
        ? ['primary_symptom']
        : ['duration_days']
      : [];

  // Safety rule: Low ASR confidence (< 0.85) NEVER suppresses a red flag;
  // instead it flags requires_clinician_review: true.
  const requiresClinicianReview = confidenceScore < 0.85 || lowConfidenceFields.length > 0;

  return {
    slots: {
      primary_symptom: primarySymptom,
      secondary_symptoms: secondarySymptoms,
      resolved_symptoms: resolvedSymptoms,
      negated_symptoms: negatedSymptoms,
      duration_days: durationDays,
      severity_grade: highestSeverity,
      spoken_vitals: { bp, temperature, sugar, medications },
      confidence_score: confidenceScore,
      requires_clinician_review: requiresClinicianReview,
    },
    lowConfidenceFields,
    redFlagsTriggered,
    normalizedTokens,
    normalizedText: normalizedFull,
  };
}

export function buildAnonymizedAbdmFhirBundle(params: {
  encounterId: string;
  createdAt: string;
  language: LanguageCode;
  slots: ClinicalSlots;
}): Record<string, unknown> {
  const { encounterId, createdAt, language, slots } = params;
  // Strip exact timestamps to coarse YYYY-MM-DD date bucket to minimize metadata leakage at rest
  const coarseDate = createdAt.slice(0, 10);
  const anonPatientRef = `Patient/anon-${encounterId}`;
  const encounterRef = `Encounter/${encounterId}`;
  const observations: Array<Record<string, unknown>> = [];

  const pushSymptom = (
    canonical: string,
    statusType: 'active' | 'resolved' | 'negated',
    idx: number
  ) => {
    const info = getSymptomDisplay(canonical, language);
    observations.push({
      fullUrl: `urn:uuid:${encounterId}-obs-${statusType}-${idx}`,
      resource: {
        resourceType: 'Observation',
        id: `${encounterId}-${statusType}-${idx}`,
        status: 'preliminary',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'exam',
                display: 'Symptom Intake',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: info.snomedCode,
              display: info.snomedDisplay,
            },
          ],
          text: info.en,
        },
        subject: { reference: anonPatientRef },
        encounter: { reference: encounterRef },
        effectiveDateTime: coarseDate,
        interpretation: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                code:
                  statusType === 'negated'
                    ? 'NEG'
                    : statusType === 'resolved'
                    ? 'IND'
                    : 'POS',
                display:
                  statusType === 'negated'
                    ? 'Absent / Explicitly Negated'
                    : statusType === 'resolved'
                    ? 'Resolved Historical Symptom'
                    : 'Active Reported Symptom',
              },
            ],
          },
        ],
        note: [
          {
            text:
              statusType === 'active'
                ? `Duration: ${slots.duration_days ?? 1}d | Severity: ${slots.severity_grade}`
                : statusType === 'resolved'
                ? 'Temporally resolved prior to intake'
                : 'Explicitly denied by patient',
          },
        ],
      },
    });
  };

  if (slots.primary_symptom !== 'none') {
    pushSymptom(slots.primary_symptom, 'active', 0);
  }
  slots.secondary_symptoms.forEach((s, i) => pushSymptom(s, 'active', i + 1));
  slots.resolved_symptoms.forEach((s, i) => pushSymptom(s, 'resolved', i));
  slots.negated_symptoms.forEach((s, i) => pushSymptom(s, 'negated', i));

  if (slots.spoken_vitals.bp) {
    observations.push({
      fullUrl: `urn:uuid:${encounterId}-vital-bp`,
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }],
        },
        subject: { reference: anonPatientRef },
        encounter: { reference: encounterRef },
        valueString: slots.spoken_vitals.bp,
      },
    });
  }

  if (slots.spoken_vitals.temperature) {
    observations.push({
      fullUrl: `urn:uuid:${encounterId}-vital-temp`,
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
        },
        subject: { reference: anonPatientRef },
        encounter: { reference: encounterRef },
        valueString: slots.spoken_vitals.temperature,
      },
    });
  }

  if (slots.spoken_vitals.sugar) {
    observations.push({
      fullUrl: `urn:uuid:${encounterId}-vital-sugar`,
      resource: {
        resourceType: 'Observation',
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '2339-0',
              display: 'Glucose [Mass/volume] in Blood',
            },
          ],
        },
        subject: { reference: anonPatientRef },
        encounter: { reference: encounterRef },
        valueString: slots.spoken_vitals.sugar,
      },
    });
  }

  return {
    resourceType: 'Bundle',
    id: `abdm-fhir-${encounterId}`,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle'],
      lastUpdated: coarseDate,
    },
    identifier: {
      system: 'https://abdm.gov.in/bhashasetu/idempotency',
      value: encounterId,
    },
    type: 'collection',
    timestamp: coarseDate,
    entry: [
      {
        fullUrl: `urn:uuid:${encounterId}-enc`,
        resource: {
          resourceType: 'Encounter',
          id: encounterId,
          status: 'finished',
          class: {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'AMB',
            display: 'Ambulatory Primary Care Intake',
          },
          subject: { reference: anonPatientRef },
          period: { start: coarseDate, end: coarseDate },
          extension: [
            {
              url: 'https://icmr.gov.in/fhir/StructureDefinition/ai-hitl-non-diagnostic',
              valueString:
                'Designed with reference to ICMR 2023 & DPDP: Structured symptoms only. PII encrypted separately on-device.',
            },
          ],
        },
      },
      ...observations,
    ],
  };
}
