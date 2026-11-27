// src/slu/__tests__/parser.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from '../normalize';
import {
  buildAnonymizedAbdmFhirBundle,
  extractDurationDays,
  parseClinicalUtterance,
} from '../parser';

describe('normalizeTranscript (Devanagari & Bengali -> Canonical Latin)', () => {
  it('1. transliterates Devanagari Hindi fever + abdominal pain', () => {
    const out = normalizeTranscript('मरीज़ को दो दिन से तेज़ बुखार और पेट में दर्द है');
    expect(out).toContain('do din');
    expect(out).toContain('tez bukhar');
    expect(out).toContain('pet mein dard');
  });

  it('2. transliterates Devanagari digits to ASCII', () => {
    expect(normalizeTranscript('३ दिन से बुखार १०२ F')).toContain('3 din se bukhar 102 f');
  });

  it('3. transliterates Bengali digits and text', () => {
    const out = normalizeTranscript('২ দিন ধরে জ্বর');
    expect(out).toContain('2 din dhore jor');
  });

  it('4. normalizes phonetic variants bhukar/bookhar -> bukhar', () => {
    expect(normalizeTranscript('bhukar aur bookhar')).toBe('bukhar aur bukhar');
  });

  it('5. normalizes Bengali jor/jwar variants', () => {
    expect(normalizeTranscript('জ্বর')).toBe('jor');
  });
});

describe('parseClinicalUtterance — Native Devanagari & Bengali', () => {
  it('6. Devanagari: high fever + abdominal pain + 2 days', () => {
    const res = parseClinicalUtterance('मरीज़ को दो दिन से तेज़ बुखार और पेट में दर्द है');
    expect(res.slots.primary_symptom).toBe('high_fever');
    expect(res.slots.secondary_symptoms).toContain('abdominal_pain');
    expect(res.slots.duration_days).toBe(2);
    expect(res.slots.severity_grade).toBe('moderate');
  });

  it('7. Devanagari: negated fever + active chest pain red flag', () => {
    const res = parseClinicalUtterance('बुखार नहीं है पर सीने में तेज़ दर्द है');
    expect(res.slots.negated_symptoms).toContain('fever');
    expect(res.slots.primary_symptom).toBe('chest_pain');
    expect(res.redFlagsTriggered).toContain('chest_pain');
    expect(res.slots.severity_grade).toBe('critical_red_flag');
  });

  it('8. Devanagari: resolved fever + implicit cardiac chest heaviness', () => {
    const res = parseClinicalUtterance('बुखार तो कल उतर गया अब छाती भारी लग रही है');
    expect(res.slots.resolved_symptoms).toContain('fever');
    expect(res.slots.primary_symptom).toBe('chest_heaviness');
    expect(res.redFlagsTriggered).toContain('chest_heaviness');
    expect(res.slots.severity_grade).toBe('critical_red_flag');
  });

  it('9. Bengali: high fever + dizziness + 2 days', () => {
    const res = parseClinicalUtterance('দুই দিন ধরে প্রচণ্ড জ্বর আর মাথা ঘোরা');
    expect(res.slots.primary_symptom).toBe('high_fever');
    expect(res.slots.secondary_symptoms).toContain('dizziness');
    expect(res.slots.duration_days).toBe(2);
  });

  it('10. Bengali: negated fever + active cardiac chest heaviness', () => {
    const res = parseClinicalUtterance('জ্বর নেই কিন্তু বুকের ভেতর চাপ লাগছে');
    expect(res.slots.negated_symptoms).toContain('fever');
    expect(res.slots.primary_symptom).toBe('chest_heaviness');
    expect(res.redFlagsTriggered).toContain('chest_heaviness');
    expect(res.slots.severity_grade).toBe('critical_red_flag');
  });

  it('11. Bengali: resolved fever + chest heaviness + BP', () => {
    const res = parseClinicalUtterance('জ্বর কাল ছিল এখন নেই, বুকের ভেতর চাপ লাগছে, BP 148/92');
    expect(res.slots.resolved_symptoms).toContain('fever');
    expect(res.slots.primary_symptom).toBe('chest_heaviness');
    expect(res.slots.spoken_vitals.bp).toBe('148/92 mmHg');
  });
});

describe('parseClinicalUtterance — Mangled ASR Typos & Fuzzy Matching', () => {
  it('12. matches mangled "bhukar do din se"', () => {
    const res = parseClinicalUtterance('bhukar do din se');
    expect(res.slots.primary_symptom).toBe('fever');
    expect(res.slots.duration_days).toBe(2);
  });

  it('13. matches mangled "bookhar teen din se"', () => {
    const res = parseClinicalUtterance('bookhar teen din se');
    expect(res.slots.primary_symptom).toBe('fever');
    expect(res.slots.duration_days).toBe(3);
  });

  it('14. matches mangled "cheene me dard"', () => {
    const res = parseClinicalUtterance('cheene me dard');
    expect(res.slots.primary_symptom).toBe('chest_pain');
    expect(res.redFlagsTriggered).toContain('chest_pain');
  });

  it('15. matches mangled "chati bhaari lag rahi hai"', () => {
    const res = parseClinicalUtterance('chati bhaari lag rahi hai');
    expect(res.slots.primary_symptom).toBe('chest_heaviness');
    expect(res.redFlagsTriggered).toContain('chest_heaviness');
  });
});

describe('Word-boundary false-positive traps & medications', () => {
  it('16. "pain is worse today" must NOT match "ors"', () => {
    const res = parseClinicalUtterance('pain is worse today');
    expect(res.slots.spoken_vitals.medications).not.toContain('ORS');
  });

  it('17. "doctors checked fever" must NOT match "ors"', () => {
    const res = parseClinicalUtterance('doctors checked fever');
    expect(res.slots.spoken_vitals.medications).not.toContain('ORS');
  });

  it('18. explicit "ors" token DOES match "ORS"', () => {
    const res = parseClinicalUtterance('patient ko dast hai, ors diya hai');
    expect(res.slots.spoken_vitals.medications).toContain('ORS');
  });

  it('19. matches paracetamol and dolo via MEDICATION_LEXICON', () => {
    const res = parseClinicalUtterance('bukhar hai, paracetamol aur dolo liya');
    expect(res.slots.spoken_vitals.medications).toEqual(['Paracetamol', 'Dolo']);
  });
});

describe('Spoken numbers, duration units, and temperature conversion', () => {
  it('20. parses "teen hafte" as 21 days', () => {
    expect(extractDurationDays('teen hafte')).toBe(21);
  });

  it('21. parses Bengali "dui soptaho" as 14 days', () => {
    expect(extractDurationDays('dui soptaho')).toBe(14);
  });

  it('22. parses "ek mahina" as 30 days', () => {
    expect(extractDurationDays('ek mahina')).toBe(30);
  });

  it('23. parses "aath din" as 8 days', () => {
    expect(extractDurationDays('aath din')).toBe(8);
  });

  it('24. parses "das din" as 10 days', () => {
    expect(extractDurationDays('das din')).toBe(10);
  });

  it('25. parses "102 F" temperature', () => {
    const res = parseClinicalUtterance('bukhar hai 102 F');
    expect(res.slots.spoken_vitals.temperature).toBe('102°F');
  });

  it('26. converts "39 C" to Fahrenheit', () => {
    const res = parseClinicalUtterance('bukhar hai 39 C');
    expect(res.slots.spoken_vitals.temperature).toBe('102.2°F (39°C)');
  });
});

describe('Clause-level negation & temporal resolution scoping', () => {
  it('27. "pehle bukhar tha ab nahi, sir dard hai" resolves fever and keeps headache active', () => {
    const res = parseClinicalUtterance('pehle bukhar tha ab nahi, sir dard hai');
    expect(res.slots.resolved_symptoms).toContain('fever');
    expect(res.slots.primary_symptom).toBe('headache');
  });

  it('28. "khansi nahi, pet mein dard hai" negates cough only', () => {
    const res = parseClinicalUtterance('khansi nahi, pet mein dard hai');
    expect(res.slots.negated_symptoms).toContain('cough');
    expect(res.slots.primary_symptom).toBe('abdominal_pain');
  });
});

describe('Safety rule: Low ASR confidence (<0.85) never suppresses red flags', () => {
  it('29. keeps red flag active and sets requires_clinician_review: true when confidence < 0.85', () => {
    const res = parseClinicalUtterance('seene mein tez dard hai', {
      snrDb: 5,
      overrideConfidence: 0.68,
    });
    expect(res.redFlagsTriggered).toContain('chest_pain');
    expect(res.slots.severity_grade).toBe('critical_red_flag');
    expect(res.slots.requires_clinician_review).toBe(true);
  });

  it('30. strips exact timestamps to YYYY-MM-DD in anonymized FHIR bundle', () => {
    const res = parseClinicalUtterance('do din se bukhar hai');
    const bundle = buildAnonymizedAbdmFhirBundle({
      encounterId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-11-25T15:20:00.123Z',
      language: 'hinglish',
      slots: res.slots,
    });
    expect(bundle.timestamp).toBe('2026-11-25');
  });
});

describe('Property test: Negated red flags NEVER trigger critical_red_flag', () => {
  const redFlagPhrases = [
    { name: 'chest_pain', hi: 'seene mein dard', bn: 'buke byatha' },
    { name: 'chest_heaviness', hi: 'chhati bhari', bn: 'buke chap' },
    { name: 'limb_numbness', hi: 'haath pair sunn', bn: 'haat pa obosh' },
    { name: 'presyncope_blackout', hi: 'aankhon ke aage andhera', bn: 'chokher samne ondhokar' },
    { name: 'unconsciousness', hi: 'behoshi', bn: 'gyan harano' },
    { name: 'seizures', hi: 'daura', bn: 'khichuni' },
  ];

  for (const rf of redFlagPhrases) {
    it(`31+. negated ${rf.name} in Hindi & Bengali never sets critical_red_flag`, () => {
      const hiRes = parseClinicalUtterance(`${rf.hi} nahi hai, sirf khansi hai`);
      expect(hiRes.redFlagsTriggered).not.toContain(rf.name);
      expect(hiRes.slots.negated_symptoms).toContain(rf.name);
      expect(hiRes.slots.severity_grade).not.toBe('critical_red_flag');

      const bnRes = parseClinicalUtterance(`${rf.bn} nei, shudhu kashi`);
      expect(bnRes.redFlagsTriggered).not.toContain(rf.name);
      expect(bnRes.slots.negated_symptoms).toContain(rf.name);
      expect(bnRes.slots.severity_grade).not.toBe('critical_red_flag');
    });
  }
});
