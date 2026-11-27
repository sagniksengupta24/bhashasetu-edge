// src/components/SimulatorSheet.tsx
// Slide-up drawer with all 7 deterministic offline test scenarios.

import React from 'react';
import { ArrowRight, X } from 'lucide-react';

export type ScenarioId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface SimulatorSheetProps {
  onClose: () => void;
  onRunScenario: (id: ScenarioId) => void;
}

const SCENARIOS: Array<{
  id: ScenarioId;
  tag: string;
  title: string;
  quote: string;
  accent: string;
}> = [
  {
    id: 1,
    tag: '01 · CLAUSE NEGATION + CHEST PAIN',
    title: 'Compound Explicit Negation',
    quote: '“Bukhar nahi hai par seene mein tez dard hai do din se”',
    accent: 'text-[#C84B31]',
  },
  {
    id: 2,
    tag: '02 · TEMPORAL + IMPLICIT CARDIAC',
    title: 'Resolved Fever + Chest Heaviness',
    quote: '“Bukhar toh kal utar gaya, ab bas chhati bhari lag rahi hai”',
    accent: 'text-[#C84B31]',
  },
  {
    id: 3,
    tag: '03 · BENGALI IDIOM + VITALS',
    title: 'Bengali Resolved Fever + Cardiac + BP',
    quote: '“Jor kal chhilo ekhon nei, buker bhetor chap lagche, BP 148/92”',
    accent: 'text-[#C84B31]',
  },
  {
    id: 4,
    tag: '04 · MISSING SLOT LOOP',
    title: 'Missing Duration Follow-Up',
    quote: '“Patient ko tej bukhar aur chakkar aana hai” → Asks duration',
    accent: 'text-[#0F3D3E]',
  },
  {
    id: 5,
    tag: '05 · LOW CONFIDENCE (<0.85 GATE)',
    title: 'SNR 6dB · Amber Verification Gate',
    quote: 'Blocks auto-save at 72% confidence until duration verified',
    accent: 'text-[#B45309]',
  },
  {
    id: 6,
    tag: '06 · NOISY CLINIC 2-STRIKE FALLBACK',
    title: 'Zero-Typing Icon + Duration Chips',
    quote: 'Triggers Strike 2/2 visual selector automatically',
    accent: 'text-[#B45309]',
  },
  {
    id: 7,
    tag: '07 · CONSENT REFUSAL (BENGALI)',
    title: 'Patient Declines Audio Recording',
    quote: 'Logs refusal timestamp & switches to tap-only mode',
    accent: 'text-[#0F3D3E]',
  },
];

export const SimulatorSheet: React.FC<SimulatorSheetProps> = ({ onClose, onRunScenario }) => {
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-[#111111]/35 backdrop-blur-[2px]"
      />

      <div className="relative z-10 bg-[#F6F5F1] rounded-t-[28px] border-t border-[#E2E0D8] shadow-[0_-16px_48px_rgba(17,17,17,0.18)] px-5 pt-3 pb-7 max-h-[84%] overflow-y-auto space-y-3.5">
        <div className="w-10 h-1 rounded-full bg-[#111111]/[0.15] mx-auto" />

        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
              Deterministic Test Bench
            </p>
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-[#111111]">
              Voice Edge-Case Simulator
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Simulator Sheet"
            className="w-8 h-8 rounded-full bg-white border border-[#E2E0D8] flex items-center justify-center text-[#6E6D68] hover:text-[#111111]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              onClick={() => onRunScenario(sc.id)}
              className="w-full bg-white hover:bg-[#EAF1F0]/40 rounded-2xl border border-[#E2E0D8] px-4 py-3 text-left transition space-y-0.5"
            >
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[10px] font-semibold tracking-[0.06em] ${sc.accent}`}>
                  {sc.tag}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#A3A19B]" />
              </div>
              <div className="text-[13px] font-semibold text-[#111111]">{sc.title}</div>
              <div className="text-[11px] text-[#6E6D68] truncate">{sc.quote}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
