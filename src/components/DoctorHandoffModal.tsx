// src/components/DoctorHandoffModal.tsx
// 4-tab modal (Triage Slip, FHIR R4, Edge JSON, AES Cipher) with copy & .fhir.json download.

import React from 'react';
import { Copy, Download, X } from 'lucide-react';
import { type DecryptedEncounter, getSymptomDisplay, type ModalTab } from '../slu/schema';
import { downloadFile } from '../sync/queue';

interface DoctorHandoffModalProps {
  record: DecryptedEncounter;
  activeTab: ModalTab;
  onTabChange: (tab: ModalTab) => void;
  onClose: () => void;
  onCopySlip: (rec: DecryptedEncounter) => void;
  onNotify: (msg: string) => void;
}

export const DoctorHandoffModal: React.FC<DoctorHandoffModalProps> = ({
  record,
  activeTab,
  onTabChange,
  onClose,
  onCopySlip,
  onNotify,
}) => {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-[#111111]/45 backdrop-blur-[2px]"
      />
      <div className="relative z-10 w-full bg-white rounded-3xl border border-[#E2E0D8] shadow-[0_24px_60px_rgba(17,17,17,0.24)] p-5 space-y-4 max-h-[86%] flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
              ABDM Interoperability · {record.stored.sync_status}
            </p>
            <h3 className="font-mono text-[14px] font-semibold text-[#111111]">
              {record.stored.encounter_id}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Doctor Handoff Modal"
            className="w-8 h-8 rounded-full bg-[#F6F5F1] flex items-center justify-center text-[#6E6D68] hover:text-[#111111]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8] shrink-0">
          {(
            [
              { id: 'slip', label: 'Triage Slip' },
              { id: 'fhir', label: 'FHIR R4' },
              { id: 'json', label: 'Edge JSON' },
              { id: 'cipher', label: 'AES Cipher' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`h-8 rounded-lg text-[10px] font-medium transition ${
                activeTab === t.id
                  ? 'bg-white text-[#111111] shadow-sm'
                  : 'text-[#6E6D68] hover:text-[#111111]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-3">
          {activeTab === 'slip' && (
            <div className="space-y-3 text-[12px]">
              <div className="bg-[#F6F5F1] rounded-2xl p-3.5 space-y-1">
                <div className="font-mono text-[10px] uppercase text-[#6E6D68]">
                  Decrypted Patient Identity (RAM)
                </div>
                <div className="font-semibold text-[#111111]">
                  {record.pii.patient.name} ({record.pii.patient.age}y / {record.pii.patient.sex})
                </div>
                {record.pii.patient.abha_id && (
                  <div className="font-mono text-[11px] text-[#0F3D3E]">
                    ABHA: {record.pii.patient.abha_id}
                  </div>
                )}
              </div>

              <div className="border border-[#E2E0D8] rounded-2xl divide-y divide-[#E2E0D8]">
                <div className="p-3">
                  <div className="font-mono text-[10px] uppercase text-[#C84B31]">
                    Active Symptoms
                  </div>
                  <div className="font-semibold text-[#111111] mt-0.5">
                    {[record.stored.slots.primary_symptom, ...record.stored.slots.secondary_symptoms]
                      .map((s) => getSymptomDisplay(s, record.stored.language).en)
                      .join(', ')}{' '}
                    ({record.stored.slots.duration_days ?? 1}d)
                  </div>
                </div>
                <div className="p-3">
                  <div className="font-mono text-[10px] uppercase text-[#0F3D3E]">
                    Resolved History
                  </div>
                  <div className="text-[#111111] mt-0.5">
                    {record.stored.slots.resolved_symptoms.length > 0
                      ? record.stored.slots.resolved_symptoms
                          .map((s) => getSymptomDisplay(s, record.stored.language).en)
                          .join(', ')
                      : 'None'}
                  </div>
                </div>
                <div className="p-3">
                  <div className="font-mono text-[10px] uppercase text-[#6E6D68]">
                    Negated Symptoms
                  </div>
                  <div className="text-[#111111] mt-0.5">
                    {record.stored.slots.negated_symptoms.length > 0
                      ? record.stored.slots.negated_symptoms
                          .map((s) => getSymptomDisplay(s, record.stored.language).en)
                          .join(', ')
                      : 'None'}
                  </div>
                </div>
                <div className="p-3">
                  <div className="font-mono text-[10px] uppercase text-[#6E6D68]">
                    Verbatim Transcript
                  </div>
                  <div className="text-[#6E6D68] italic mt-0.5">
                    “{record.pii.raw_transcript}”
                  </div>
                </div>
              </div>

              <button
                onClick={() => onCopySlip(record)}
                className="w-full h-11 rounded-2xl bg-[#0F3D3E] text-white text-[13px] font-medium inline-flex items-center justify-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy eSanjeevani Triage Slip</span>
              </button>
            </div>
          )}

          {activeTab === 'fhir' && (
            <div className="space-y-3">
              <pre className="bg-[#111111] text-[#EAF1F0] font-mono text-[10px] leading-relaxed p-3.5 rounded-2xl max-h-64 overflow-auto">
                {JSON.stringify(record.stored.anonymized_fhir_envelope, null, 2)}
              </pre>
              <button
                onClick={() => {
                  downloadFile(
                    `${record.stored.encounter_id}.fhir.json`,
                    JSON.stringify(record.stored.anonymized_fhir_envelope, null, 2)
                  );
                  onNotify(`Exported ${record.stored.encounter_id}.fhir.json`);
                }}
                className="w-full h-11 rounded-2xl bg-[#0F3D3E] text-white text-[13px] font-medium inline-flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .fhir.json Bundle</span>
              </button>
            </div>
          )}

          {activeTab === 'json' && (
            <pre className="bg-[#111111] text-[#EAF1F0] font-mono text-[10px] leading-relaxed p-3.5 rounded-2xl max-h-72 overflow-auto">
              {JSON.stringify(
                {
                  encounter_id: record.stored.encounter_id,
                  language: record.stored.language,
                  slots: record.stored.slots,
                  pii: record.pii,
                },
                null,
                2
              )}
            </pre>
          )}

          {activeTab === 'cipher' && (
            <div className="space-y-3">
              <div className="bg-[#EAF1F0]/70 border border-[#0F3D3E]/20 rounded-2xl p-3 text-[11px] text-[#0F3D3E]">
                <span className="font-semibold block">
                  Passphrase-Derived Envelope AES-256-GCM Cipher
                </span>
                Encrypted PII blob stored in <span className="font-mono">BhashaSetuEdgeDB</span>.
                Random 256-bit DEK is wrapped by PBKDF2 (600k SHA-256) and wiped on lock.
              </div>
              <pre className="bg-[#111111] text-[#EAF1F0] font-mono text-[10px] leading-relaxed p-3.5 rounded-2xl max-h-56 overflow-auto break-all whitespace-pre-wrap">
                {JSON.stringify(
                  {
                    encounter_id: record.stored.encounter_id,
                    sync_status: record.stored.sync_status,
                    encrypted_pii: record.stored.encrypted_pii,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
