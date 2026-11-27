// src/slu/validation.ts
// Pure input validators for Patient Identity & Transcript fields.

import type { PatientProfile } from './schema';

export const MAX_PATIENT_NAME_LEN = 80;
export const MAX_TRANSCRIPT_LEN = 1000;
export const ABHA_ID_REGEX = /^\d{2}-\d{4}-\d{4}-\d{4}$/;

export interface PatientValidationResult {
  valid: boolean;
  sanitized: PatientProfile;
  errors: {
    name?: string;
    age?: string;
    abha_id?: string;
  };
}

export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, '');
}

export function sanitizePatientName(raw: string): string {
  return stripControlChars(raw).trim().slice(0, MAX_PATIENT_NAME_LEN);
}

export function validatePatientProfile(profile: PatientProfile): PatientValidationResult {
  const errors: PatientValidationResult['errors'] = {};
  const rawCleanName = stripControlChars(profile.name).trim();

  if (rawCleanName.length > MAX_PATIENT_NAME_LEN) {
    errors.name = `Name must be ${MAX_PATIENT_NAME_LEN} characters or fewer.`;
  }

  const trimmedAge = profile.age.trim();
  if (trimmedAge !== '') {
    if (!/^-?\d+$/.test(trimmedAge)) {
      errors.age = 'Age must be a whole number (0–120).';
    } else {
      const numAge = Number(trimmedAge);
      if (!Number.isInteger(numAge) || numAge < 0 || numAge > 120) {
        errors.age = 'Age must be between 0 and 120.';
      }
    }
  }

  const trimmedAbha = profile.abha_id.trim();
  if (trimmedAbha !== '' && !ABHA_ID_REGEX.test(trimmedAbha)) {
    errors.abha_id = 'ABHA ID must match XX-XXXX-XXXX-XXXX (14 digits).';
  }

  return {
    valid: Object.keys(errors).length === 0,
    sanitized: {
      name: rawCleanName.slice(0, MAX_PATIENT_NAME_LEN),
      age: trimmedAge,
      sex: profile.sex,
      abha_id: trimmedAbha,
    },
    errors,
  };
}

export function validateTranscriptInput(raw: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  const cleaned = stripControlChars(raw).trim();
  if (cleaned.length > MAX_TRANSCRIPT_LEN) {
    return {
      valid: false,
      sanitized: cleaned.slice(0, MAX_TRANSCRIPT_LEN),
      error: `Transcript cannot exceed ${MAX_TRANSCRIPT_LEN} characters.`,
    };
  }
  return { valid: true, sanitized: cleaned };
}
