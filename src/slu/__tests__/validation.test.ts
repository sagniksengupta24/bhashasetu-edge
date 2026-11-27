// src/slu/__tests__/validation.test.ts
import { describe, expect, it } from 'vitest';
import {
  MAX_PATIENT_NAME_LEN,
  MAX_TRANSCRIPT_LEN,
  sanitizePatientName,
  validatePatientProfile,
  validateTranscriptInput,
} from '../validation';

describe('validatePatientProfile & validateTranscriptInput', () => {
  it('strips control characters and trims patient name', () => {
    const cleaned = sanitizePatientName('  Sunita\u0000\u0007 Devi  ');
    expect(cleaned).toBe('Sunita Devi');
  });

  it('rejects negative age and age 999', () => {
    const neg = validatePatientProfile({ name: 'Asha', age: '-5', sex: 'F', abha_id: '' });
    expect(neg.valid).toBe(false);
    expect(neg.errors.age).toBeDefined();

    const huge = validatePatientProfile({ name: 'Asha', age: '999', sex: 'F', abha_id: '' });
    expect(huge.valid).toBe(false);
    expect(huge.errors.age).toBeDefined();
  });

  it('accepts valid integer ages 0 and 120 and empty optional age', () => {
    expect(validatePatientProfile({ name: 'Baby', age: '0', sex: 'F', abha_id: '' }).valid).toBe(
      true
    );
    expect(validatePatientProfile({ name: 'Elder', age: '120', sex: 'M', abha_id: '' }).valid).toBe(
      true
    );
    expect(validatePatientProfile({ name: 'Anon', age: '', sex: 'O', abha_id: '' }).valid).toBe(
      true
    );
  });

  it('rejects malformed ABHA IDs and accepts 14-digit XX-XXXX-XXXX-XXXX', () => {
    const bad = validatePatientProfile({
      name: 'Meena',
      age: '42',
      sex: 'F',
      abha_id: '1234-5678',
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.abha_id).toBeDefined();

    const good = validatePatientProfile({
      name: 'Meena',
      age: '42',
      sex: 'F',
      abha_id: '24-5819-4402-9104',
    });
    expect(good.valid).toBe(true);
  });

  it('rejects oversized name (>80 chars) and oversized transcript (>1000 chars)', () => {
    const longName = 'A'.repeat(MAX_PATIENT_NAME_LEN + 5);
    const resName = validatePatientProfile({ name: longName, age: '30', sex: 'F', abha_id: '' });
    expect(resName.valid).toBe(false);
    expect(resName.errors.name).toBeDefined();

    const longText = 'x'.repeat(MAX_TRANSCRIPT_LEN + 1);
    const resTx = validateTranscriptInput(longText);
    expect(resTx.valid).toBe(false);
    expect(resTx.error).toBeDefined();
  });
});
