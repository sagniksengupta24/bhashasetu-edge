// src/App.tsx
// Clean top-level orchestrator for Home, Active Intake (with encrypted DRAFT autosave),
// and Offline Queue views.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Download,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Check,
  X,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Sliders,
  Layers,
  Thermometer,
  HeartPulse,
  Wind,
  Clock,
  Edit3,
  RotateCcw,
  FileJson,
  PhoneCall,
  CheckCircle2,
  ChevronRight,
  Lock,
  ShieldCheck,
  Cpu,
  User,
  Activity,
  FileText,
} from 'lucide-react';
import { VaultCrypto } from './crypto/vault';
import {
  getStorageUsage,
  requestPersistentStorage,
  type StorageUsageInfo,
} from './db/storageGuard';
import { startWhisperDspCapture, type WhisperAudioSession } from './dsp/audioProcessor';
import {
  buildAnonymizedAbdmFhirBundle,
  extractDurationDays,
  parseClinicalUtterance,
} from './slu/parser';
import {
  validatePatientProfile,
  validateTranscriptInput,
} from './slu/validation';
import {
  type AsrEngineMode,
  type ClinicalSlots,
  type DecryptedEncounter,
  type EncounterPII,
  getSymptomDisplay,
  type IntakeStep,
  LANGUAGE_META,
  type LanguageCode,
  type ModalTab,
  type PatientProfile,
  type StoredEncounterRecord,
  type ViewMode,
  type WorkerState,
} from './slu/schema';
import {
  createSeedEncounter,
  dbLoadDecryptedEncounters,
  dbSaveEncounter,
  exportEncryptedBackupBundle,
  flushPendingQueue,
  registerOnlineSyncFallback,
} from './sync/queue';
import { DoctorHandoffModal } from './components/DoctorHandoffModal';
import { type CacheBucketInfo, EngineDrawer } from './components/EngineDrawer';
import { PinLockGate } from './components/PinLockGate';
import { type ScenarioId, SimulatorSheet } from './components/SimulatorSheet';
import type { PromptKey } from './tts/promptClips';
import {
  buildNativeReadbackText,
  type NeuralVoiceState,
  voiceEngine,
} from './tts/voiceEngine';

type ListenContext = 'consent' | 'symptom' | 'duration' | 'readback' | 'edit';

interface BrowserSpeechRecognitionResult {
  isFinal?: boolean;
  0?: { transcript?: string };
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results?: ArrayLike<BrowserSpeechRecognitionResult> }) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function App() {
  // Vault Security State (auto-boots into ephemeral RAM-only DEK when no passphrase is set)
  const [bootingVault, setBootingVault] = useState<boolean>(true);
  const [vaultInitialized, setVaultInitialized] = useState<boolean>(false);
  const [vaultUnlocked, setVaultUnlocked] = useState<boolean>(() => VaultCrypto.isUnlocked());
  const [showPassphraseSetup, setShowPassphraseSetup] = useState<boolean>(false);

  // Navigation & Global State
  const [view, setView] = useState<ViewMode>('home');
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : false
  );
  const [ttsMuted, setTtsMuted] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [lastSpoken, setLastSpoken] = useState<string>('');
  const [ttsPackMissing, setTtsPackMissing] = useState<boolean>(false);

  // Drawers & Modals
  const [simSheetOpen, setSimSheetOpen] = useState<boolean>(false);
  const [engineDrawerOpen, setEngineDrawerOpen] = useState<boolean>(false);
  const [icmrModalOpen, setIcmrModalOpen] = useState<boolean>(false);
  const [patientModalOpen, setPatientModalOpen] = useState<boolean>(false);
  const [handoffRecord, setHandoffRecord] = useState<DecryptedEncounter | null>(null);
  const [handoffTab, setHandoffTab] = useState<ModalTab>('slip');

  // Toast
  const [toast, setToast] = useState<{ text: string; tone?: 'neutral' | 'warn' } | null>(null);

  // Worker, DSP & PWA Cache State
  const [asrEngine, setAsrEngine] = useState<AsrEngineMode>('whisper_worker');
  const [workerState, setWorkerState] = useState<WorkerState>('idle');
  const [workerProgress, setWorkerProgress] = useState<number>(0);
  const [lastDecodeMs, setLastDecodeMs] = useState<number | null>(null);
  const [neuralVoiceState, setNeuralVoiceState] = useState<NeuralVoiceState>('idle');
  const [neuralVoiceProgress, setNeuralVoiceProgress] = useState<number>(0);
  const [neuralVoiceLang, setNeuralVoiceLang] = useState<'hi' | 'bn' | null>(null);
  const [liveSnrDb, setLiveSnrDb] = useState<number>(18);
  const [swStatus, setSwStatus] = useState<'checking' | 'registered' | 'unsupported'>('checking');
  const [cacheBuckets, setCacheBuckets] = useState<CacheBucketInfo[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageUsageInfo | null>(null);
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);
  const [backendUnreachable, setBackendUnreachable] = useState<boolean>(false);
  const [patientErrors, setPatientErrors] = useState<{
    name?: string;
    age?: string;
    abha_id?: string;
  }>({});
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Split Encrypted Queue & Sync State
  const [records, setRecords] = useState<DecryptedEncounter[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [simulateFlaky3G, setSimulateFlaky3G] = useState<boolean>(false);
  const [syncTelemetry, setSyncTelemetry] = useState<string | null>(null);

  // Active Intake & Patient Identity State
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [lang, setLang] = useState<LanguageCode>('hinglish');
  const [step, setStep] = useState<IntakeStep>(1);
  const [patient, setPatient] = useState<PatientProfile>({
    name: '',
    age: '',
    sex: 'F',
    abha_id: '',
  });
  const [consentTimestamp, setConsentTimestamp] = useState<string | null>(null);
  const [consentMode, setConsentMode] = useState<'verbal_granted' | 'declined_manual_tap'>(
    'verbal_granted'
  );
  const [manualTapMode, setManualTapMode] = useState<boolean>(false);

  // Audio, Waveform & 2-Strike State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [listenMode, setListenMode] = useState<ListenContext>('symptom');
  const [strikeCount, setStrikeCount] = useState<number>(0);
  const [strikeBanner, setStrikeBanner] = useState<string | null>(null);
  const [eqBars, setEqBars] = useState<number[]>([18, 26, 20, 34, 22, 30, 18, 28, 24, 18]);

  // Structured Extraction State
  const [rawTranscript, setRawTranscript] = useState<string>('');
  const [typedInput, setTypedInput] = useState<string>('');
  const [normalizedTokens, setNormalizedTokens] = useState<string[]>([]);
  const [redFlagsTriggered, setRedFlagsTriggered] = useState<string[]>([]);
  const [slots, setSlots] = useState<ClinicalSlots | null>(null);
  const [lowConfidenceFields, setLowConfidenceFields] = useState<string[]>([]);
  const [awaitingDuration, setAwaitingDuration] = useState<boolean>(false);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [editingField, setEditingField] = useState<
    'primary_symptom' | 'duration_days' | 'spoken_vitals' | null
  >(null);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);

  // Zero-Typing Visual Fallback State
  const [tapSymptom, setTapSymptom] = useState<string>('fever');
  const [tapDuration, setTapDuration] = useState<number>(2);

  // Hardware & Worker Refs
  const workerRef = useRef<Worker | null>(null);
  const workerWatchdogRef = useRef<number | null>(null);
  const pendingWorkerContextRef = useRef<ListenContext>('symptom');
  const whisperSessionRef = useRef<WhisperAudioSession | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechBufferRef = useRef<string>('');
  const speechContextRef = useRef<ListenContext>('symptom');
  const silenceTimerRef = useRef<number | null>(null);
  const liveSnrRef = useRef<number>(18);
  const recordsRef = useRef<DecryptedEncounter[]>(records);
  recordsRef.current = records;

  const showToast = useCallback((text: string, tone: 'neutral' | 'warn' = 'neutral') => {
    setToast({ text, tone });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }, []);

  const refreshCacheStatus = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && 'caches' in window) {
        const keys = await window.caches.keys();
        const buckets: CacheBucketInfo[] = [];
        for (const k of keys) {
          const c = await window.caches.open(k);
          const reqs = await c.keys();
          buckets.push({ name: k, entries: reqs.length });
        }
        setCacheBuckets(buckets);
      }
      const usage = await getStorageUsage();
      setStorageInfo(usage);
    } catch {
      // Ignore cache inspection errors
    }
  }, []);

  // ==========================================================================
  // ENCRYPTED DRAFT AUTOSAVE BEFORE IDLE / VISIBILITY LOCK
  // ==========================================================================

  const persistActiveDraft = useCallback(async () => {
    if (!VaultCrypto.isUnlocked() || view !== 'intake' || step === 4 || !slots) return;
    const draftId = activeDraftId || globalThis.crypto.randomUUID();
    if (!activeDraftId) setActiveDraftId(draftId);

    const createdAt = new Date().toISOString();
    const pii: EncounterPII = {
      patient: {
        name: patient.name.trim() || 'Draft Patient',
        age: patient.age.trim() || '35',
        sex: patient.sex,
        abha_id: patient.abha_id.trim(),
      },
      raw_transcript: rawTranscript,
      consent_timestamp: consentTimestamp || createdAt,
      consent_mode: consentMode,
    };

    try {
      const encrypted_pii = await VaultCrypto.encryptJSON(pii);
      const draftRecord: StoredEncounterRecord = {
        encounter_id: draftId,
        idempotency_key: draftId,
        created_at: createdAt,
        language: lang,
        asr_engine: asrEngine,
        snr_db: liveSnrRef.current,
        red_flags_triggered: redFlagsTriggered,
        slots,
        sync_status: 'DRAFT',
        retry_count: 0,
        is_ephemeral: VaultCrypto.isEphemeral(),
        encrypted_pii,
        anonymized_fhir_envelope: buildAnonymizedAbdmFhirBundle({
          encounterId: draftId,
          createdAt,
          language: lang,
          slots,
        }),
      };
      await dbSaveEncounter(draftRecord);
      setRecords((prev) => [
        { stored: draftRecord, pii },
        ...prev.filter((r) => r.stored.encounter_id !== draftId),
      ]);
    } catch (err) {
      if (err instanceof Error && err.message.includes('QUOTA_EXCEEDED')) {
        setQuotaBanner('Device storage full — sync or export encrypted backup to free space.');
      }
    }
  }, [
    activeDraftId,
    asrEngine,
    consentMode,
    consentTimestamp,
    lang,
    patient,
    rawTranscript,
    redFlagsTriggered,
    slots,
    step,
    view,
  ]);

  useEffect(() => {
    if (!vaultUnlocked || view !== 'intake' || step === 4 || !slots) return;
    const timer = window.setTimeout(() => {
      void persistActiveDraft();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [vaultUnlocked, view, step, slots, patient, rawTranscript, persistActiveDraft]);

  // ==========================================================================
  // EPHEMERAL SESSION BOOT + AUTO-LOCK ON VISIBILITYCHANGE & 5-MINUTE IDLE
  // ==========================================================================

  useEffect(() => {
    let active = true;
    (async () => {
      const initialized = await VaultCrypto.isInitialized();
      if (!active) return;
      setVaultInitialized(initialized);
      if (!initialized) {
        if (!VaultCrypto.isUnlocked()) {
          await VaultCrypto.unlockEphemeralSession();
        }
        if (active) setVaultUnlocked(true);
      } else {
        setVaultUnlocked(VaultCrypto.isUnlocked());
      }
      if (active) setBootingVault(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleLockVault = useCallback(() => {
    if (!vaultInitialized) {
      setShowPassphraseSetup(true);
      return;
    }
    void persistActiveDraft().finally(() => {
      VaultCrypto.lock();
      void voiceEngine.dispose();
      setRecords([]);
      setHandoffRecord(null);
      setView('home');
      setVaultUnlocked(false);
    });
  }, [persistActiveDraft, vaultInitialized]);

  const handleVaultUnlocked = useCallback(async () => {
    const wasSetup = showPassphraseSetup;
    setVaultInitialized(true);
    setShowPassphraseSetup(false);
    setVaultUnlocked(true);

    // Re-encrypt any in-memory ephemeral records under the new passphrase-wrapped DEK
    if (wasSetup && recordsRef.current.length > 0) {
      const reencrypted: DecryptedEncounter[] = [];
      for (const rec of recordsRef.current) {
        try {
          const encrypted_pii = await VaultCrypto.encryptJSON(rec.pii);
          const nextStored: StoredEncounterRecord = {
            ...rec.stored,
            is_ephemeral: false,
            encrypted_pii,
          };
          await dbSaveEncounter(nextStored);
          reencrypted.push({ stored: nextStored, pii: rec.pii });
        } catch {
          reencrypted.push(rec);
        }
      }
      setRecords(reencrypted);
      showToast('Passphrase vault active · Records locked with PBKDF2 600k');
    }
  }, [showPassphraseSetup, showToast]);

  useEffect(() => {
    if (!vaultUnlocked || !vaultInitialized) return;

    const resetIdle = () => VaultCrypto.touchSession(handleLockVault);
    resetIdle();

    const onVisibility = () => {
      if (document.hidden) {
        handleLockVault();
      }
    };

    window.addEventListener('pointerdown', resetIdle, { passive: true });
    window.addEventListener('keydown', resetIdle, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pointerdown', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [vaultUnlocked, vaultInitialized, handleLockVault]);

  // ==========================================================================
  // EPHEMERAL BEFOREUNLOAD GUARD + MULTI-TAB BROADCAST SYNC
  // ==========================================================================

  useEffect(() => {
    if (vaultInitialized) return;
    const hasEphemeral = records.some((r) => r.stored.is_ephemeral);
    if (!hasEphemeral) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [vaultInitialized, records]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('bhashasetu-state');
    bc.onmessage = (event) => {
      const msgType = event.data?.type;
      if (msgType === 'VAULT_LOCKED' || msgType === 'VAULT_WIPED') {
        if (vaultInitialized) {
          VaultCrypto.lock(true);
          setRecords([]);
          setHandoffRecord(null);
          setVaultUnlocked(false);
        }
      } else if (msgType === 'QUEUE_UPDATED' && VaultCrypto.isUnlocked()) {
        void dbLoadDecryptedEncounters().then(({ records: reloaded }) => {
          if (reloaded.length > 0) setRecords(reloaded);
        });
      }
    };
    return () => bc.close();
  }, [vaultInitialized]);

  // ==========================================================================
  // LOAD DECRYPTED RECORDS ON UNLOCK + INSPECT SW/CACHE + PERSISTENT STORAGE
  // ==========================================================================

  useEffect(() => {
    if (!vaultUnlocked) return;
    let mounted = true;

    (async () => {
      await requestPersistentStorage();
      const { records: loaded, prunedEphemeralCount } = await dbLoadDecryptedEncounters();
      if (!mounted) return;
      if (prunedEphemeralCount > 0) {
        showToast(
          'Previous temporary session cleared — set a passphrase to persist local records across reloads',
          'warn'
        );
      }
      if (loaded.length === 0) {
        try {
          const seeded = await createSeedEncounter();
          if (mounted) setRecords([seeded]);
        } catch {
          // Ignore if DB unavailable
        }
      } else {
        setRecords(loaded);
      }
    })();

    (async () => {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (mounted) setSwStatus(reg ? 'registered' : 'unsupported');
        } catch {
          if (mounted) setSwStatus('unsupported');
        }
      } else if (mounted) {
        setSwStatus('unsupported');
      }
      if (mounted) await refreshCacheStatus();
    })();

    return () => {
      mounted = false;
    };
  }, [vaultUnlocked, refreshCacheStatus]);

  // ==========================================================================
  // CROSS-BROWSER ONLINE SYNC FALLBACK (SAFARI / FIREFOX)
  // ==========================================================================

  const handleSyncNow = useCallback(
    async (forceOnline = false) => {
      const queueable = recordsRef.current.filter(
        (r) => r.stored.sync_status === 'QUEUED' || r.stored.sync_status === 'FAILED_RETRYABLE'
      );
      if (queueable.length === 0) {
        showToast('No queued records pending sync');
        return;
      }
      if (!forceOnline && !isOnline) {
        showToast('Offline Mode active — toggle Online to sync', 'warn');
        return;
      }

      setIsSyncing(true);
      setSyncTelemetry('Preparing zero-PII ABDM FHIR R4 batch…');

      const result = await flushPendingQueue(recordsRef.current, {
        simulateFlaky3G,
        onTelemetry: (msg) => setSyncTelemetry(msg),
        onRecordUpdated: (updated) => {
          setRecords((prev) =>
            prev.map((item) =>
              item.stored.encounter_id === updated.stored.encounter_id ? updated : item
            )
          );
        },
      });

      setRecords(result.updatedRecords);
      setBackendUnreachable(result.backendUnreachable);
      setIsSyncing(false);
      setSyncTelemetry(null);

      if (result.skippedDueToLock) {
        showToast('Sync already running in another tab');
      } else if (result.deadLetterCount > 0) {
        showToast(
          `ACKed ${result.ackedCount} · ${result.deadLetterCount} 4xx dead-lettered`,
          'warn'
        );
      } else if (result.demoSimulatedCount > 0) {
        showToast(
          `Demo simulated ${result.demoSimulatedCount} record${
            result.demoSimulatedCount !== 1 ? 's' : ''
          } (no server ACK)`
        );
      } else if (result.backendUnreachable) {
        showToast('Backend unreachable — queued locally for retry', 'warn');
      } else {
        showToast(
          `ACKed ${result.ackedCount}/${queueable.length} anonymized FHIR bundle${
            result.ackedCount !== 1 ? 's' : ''
          }`
        );
      }
    },
    [isOnline, showToast, simulateFlaky3G]
  );

  useEffect(() => {
    if (!vaultUnlocked) return;
    const cleanup = registerOnlineSyncFallback(() => {
      setIsOnline(true);
      if (
        recordsRef.current.some(
          (r) => r.stored.sync_status === 'QUEUED' || r.stored.sync_status === 'FAILED_RETRYABLE'
        )
      ) {
        void handleSyncNow(true);
      }
    });
    return cleanup;
  }, [vaultUnlocked, handleSyncNow]);

  // ==========================================================================
  // 3-TIER NEURAL VOICE ENGINE (STUDIO CLIPS -> NINADA 24KHZ -> FALLBACK)
  // ==========================================================================

  useEffect(() => {
    voiceEngine.setCallbacks({
      onSpeakingChange: setIsSpeaking,
      onCaption: setLastSpoken,
      onVoicePackMissing: setTtsPackMissing,
      onNeuralStateChange: (state, progress, loadedLang) => {
        setNeuralVoiceState(state);
        setNeuralVoiceProgress(progress);
        setNeuralVoiceLang(loadedLang);
      },
    });
  }, []);

  const speakPrompt = useCallback(
    (key: PromptKey, fallbackText: string, langOverride?: LanguageCode) => {
      void voiceEngine.speakPrompt(key, langOverride || lang, fallbackText);
    },
    [lang]
  );

  const handleLoadNeuralVoice = useCallback(async () => {
    const ok = await voiceEngine.loadNeuralVoice(lang);
    if (ok) {
      await refreshCacheStatus();
      showToast('Ninada 24 kHz neural voice ready');
    } else {
      showToast('Ninada load failed — using studio clips + browser fallback', 'warn');
    }
  }, [lang, refreshCacheStatus, showToast]);

  // ==========================================================================
  // HARDWARE AUDIO & WORKER CLEANUP
  // ==========================================================================

  const stopAudioHardware = useCallback(() => {
    setIsRecording(false);
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
      recognitionRef.current = null;
    }
    if (whisperSessionRef.current) {
      whisperSessionRef.current.abort();
      whisperSessionRef.current = null;
    }
    setEqBars([18, 24, 18, 28, 20, 24, 18, 22, 18, 16]);
  }, []);

  useEffect(() => {
    return () => {
      stopAudioHardware();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      void voiceEngine.dispose();
    };
  }, [stopAudioHardware]);

  const resumeDraftEncounter = useCallback(
    (rec: DecryptedEncounter) => {
      stopAudioHardware();
      setActiveDraftId(rec.stored.encounter_id);
      setLang(rec.stored.language);
      setPatient(rec.pii.patient);
      setRawTranscript(rec.pii.raw_transcript);
      setConsentTimestamp(rec.pii.consent_timestamp);
      setConsentMode(rec.pii.consent_mode);
      setSlots(rec.stored.slots);
      setRedFlagsTriggered(rec.stored.red_flags_triggered);
      setLowConfidenceFields(
        rec.stored.slots.requires_clinician_review ? ['duration_days'] : []
      );
      setNormalizedTokens([]);
      setAwaitingDuration(rec.stored.slots.duration_days === null);
      setStep(rec.stored.slots.duration_days === null ? 2 : 3);
      setView('intake');
      showToast('Resumed encrypted draft');
    },
    [showToast, stopAudioHardware]
  );

  // ==========================================================================
  // 4-STEP CLINICAL VOICE FLOW HANDLERS
  // ==========================================================================

  const startLanguageIntake = (code: LanguageCode) => {
    stopAudioHardware();
    setActiveDraftId(globalThis.crypto.randomUUID());
    setLang(code);
    setStep(1);
    setConsentTimestamp(null);
    setConsentMode('verbal_granted');
    setManualTapMode(false);
    setStrikeCount(0);
    setStrikeBanner(null);
    setRawTranscript('');
    setTypedInput('');
    setNormalizedTokens([]);
    setRedFlagsTriggered([]);
    setSlots(null);
    setLowConfidenceFields([]);
    setAwaitingDuration(false);
    setEditingField(null);
    setShowRawJson(false);
    setSavedRecordId(null);
    setView('intake');
    speakPrompt('consent', LANGUAGE_META[code].consentPrompt, code);
  };

  const handleGrantConsent = useCallback(() => {
    stopAudioHardware();
    setConsentTimestamp(new Date().toISOString());
    setConsentMode('verbal_granted');
    setManualTapMode(false);
    setStep(2);
    setStrikeBanner(null);
    showToast('Consent timestamp logged');
  }, [showToast, stopAudioHardware]);

  const handleDeclineConsent = useCallback(
    (langOverride?: LanguageCode) => {
      const activeLang = langOverride || lang;
      stopAudioHardware();
      setConsentTimestamp(new Date().toISOString());
      setConsentMode('declined_manual_tap');
      setManualTapMode(true);
      setStep(2);
      speakPrompt('consent_declined', LANGUAGE_META[activeLang].consentDeclined, activeLang);
      showToast('Recording disabled · Tap-only mode active');
    },
    [lang, showToast, speakPrompt, stopAudioHardware]
  );

  const speakReadback = useCallback(
    (s: ClinicalSlots, langOverride?: LanguageCode) => {
      const activeLang = langOverride || lang;
      const meta = LANGUAGE_META[activeLang];
      const names = [
        getSymptomDisplay(s.primary_symptom, activeLang).spoken,
        ...s.secondary_symptoms.map((sym) => getSymptomDisplay(sym, activeLang).spoken),
      ].join(` ${meta.andWord} `);
      const dur = s.duration_days ?? 1;
      const displayText = `${meta.readbackPrefix} ${names}, ${dur} ${meta.daysWord}. ${meta.readbackSuffix}`;
      const nativeText = buildNativeReadbackText(s, activeLang);
      void voiceEngine.speakDynamic(displayText, activeLang, nativeText);
    },
    [lang]
  );

  // Step 4: Validate Patient + Encrypt PII via RAM DEK + Build Coarse-Dated FHIR Envelope -> QUEUED
  const finalizeAndSave = useCallback(
    async (
      finalSlots: ClinicalSlots,
      transcriptText: string,
      redFlags: string[],
      engineUsed: AsrEngineMode | 'simulator' = asrEngine
    ) => {
      const validation = validatePatientProfile(patient);
      if (!validation.valid) {
        setPatientErrors(validation.errors);
        setPatientModalOpen(true);
        showToast('Fix patient identity validation errors before saving', 'warn');
        return;
      }

      stopAudioHardware();
      const encounterId = activeDraftId || globalThis.crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const pii: EncounterPII = {
        patient: {
          name: validation.sanitized.name || 'Rural Clinic Patient',
          age: validation.sanitized.age || '35',
          sex: validation.sanitized.sex,
          abha_id: validation.sanitized.abha_id,
        },
        raw_transcript: transcriptText,
        consent_timestamp: consentTimestamp || createdAt,
        consent_mode: consentMode,
      };

      const encrypted_pii = await VaultCrypto.encryptJSON(pii);
      const anonymized_fhir_envelope = buildAnonymizedAbdmFhirBundle({
        encounterId,
        createdAt,
        language: lang,
        slots: finalSlots,
      });

      const stored: StoredEncounterRecord = {
        encounter_id: encounterId,
        idempotency_key: encounterId,
        created_at: createdAt,
        language: lang,
        asr_engine: engineUsed,
        snr_db: liveSnrRef.current,
        red_flags_triggered: redFlags,
        slots: finalSlots,
        sync_status: 'QUEUED',
        retry_count: 0,
        is_ephemeral: VaultCrypto.isEphemeral(),
        encrypted_pii,
        anonymized_fhir_envelope,
      };

      try {
        await dbSaveEncounter(stored);
      } catch (err) {
        if (err instanceof Error && err.message.includes('QUOTA_EXCEEDED')) {
          setQuotaBanner('Device storage full — sync or export encrypted backup to free space.');
        }
      }

      setRecords((prev) => [
        { stored, pii },
        ...prev.filter((r) => r.stored.encounter_id !== encounterId),
      ]);
      setSavedRecordId(encounterId);
      setActiveDraftId(null);
      setStep(4);

      if (redFlags.length > 0 || finalSlots.severity_grade === 'critical_red_flag') {
        speakPrompt('redflag', LANGUAGE_META[lang].emergencyAlert, lang);
      } else {
        speakPrompt('saved', LANGUAGE_META[lang].savedConfirm, lang);
      }
    },
    [
      activeDraftId,
      asrEngine,
      consentMode,
      consentTimestamp,
      lang,
      patient,
      speakPrompt,
      stopAudioHardware,
    ]
  );

  const triggerAcousticStrike = useCallback(
    (langOverride?: LanguageCode) => {
      const activeLang = langOverride || lang;
      setStrikeCount((prev) => {
        const next = prev + 1;
        if (next === 1) {
          setStrikeBanner('Strike 1 of 2 · Low SNR / clinic noise. Move closer and retry.');
          speakPrompt('noise_retry', LANGUAGE_META[activeLang].noiseRetryPrompt, activeLang);
        } else {
          setStrikeBanner('Strike 2 of 2 · Switched to zero-typing visual selector.');
          setStep(2);
          setAwaitingDuration(false);
          speakPrompt('visual_fallback', LANGUAGE_META[activeLang].visualFallbackPrompt, activeLang);
        }
        return next;
      });
    },
    [lang, speakPrompt]
  );

  const processUtterance = useCallback(
    (
      transcript: string,
      context: ListenContext,
      simOpts?: {
        snrDb?: number;
        overrideConfidence?: number;
        lowConfidenceFields?: string[];
        langOverride?: LanguageCode;
      }
    ) => {
      const clean = transcript.trim();
      const activeLang = simOpts?.langOverride || lang;

      if (!clean) {
        triggerAcousticStrike(activeLang);
        return;
      }

      if (context === 'consent') {
        const lower = clean.toLowerCase();
        if (/\b(nahi|na|no|band|mat|bondho)\b/i.test(lower)) {
          handleDeclineConsent(activeLang);
        } else if (/\b(haan|ha|yes|ji|sahi|ok|thik)\b/i.test(lower)) {
          handleGrantConsent();
        } else {
          speakPrompt('consent', LANGUAGE_META[activeLang].consentPrompt, activeLang);
        }
        return;
      }

      if (context === 'duration' && slots) {
        const days = extractDurationDays(clean);
        if (days !== null) {
          const updated: ClinicalSlots = {
            ...slots,
            duration_days: days,
            confidence_score: Math.min(0.96, Math.max(slots.confidence_score, 0.91)),
            requires_clinician_review: false,
          };
          setSlots(updated);
          setRawTranscript((prev) => `${prev} · (${clean})`);
          setNormalizedTokens((prev) => [...prev, `duration:${days}d`]);
          setLowConfidenceFields((prev) => prev.filter((f) => f !== 'duration_days'));
          setAwaitingDuration(false);
          setStrikeBanner(null);
          setStep(3);
          speakReadback(updated, activeLang);
        } else {
          triggerAcousticStrike(activeLang);
        }
        return;
      }

      if (context === 'readback' && slots) {
        const lower = clean.toLowerCase();
        if (/\b(din|duration|time|samay|somoy)\b/i.test(lower)) {
          setEditingField('duration_days');
          speakPrompt('duration_edit', LANGUAGE_META[activeLang].durationEditPrompt, activeLang);
          return;
        }
        if (/\b(symptom|lakshan|lokkhon|dard|bukhar|jor)\b/i.test(lower)) {
          setEditingField('primary_symptom');
          speakPrompt('symptom_edit', LANGUAGE_META[activeLang].symptomEditPrompt, activeLang);
          return;
        }
        if (/\b(haan|ha|yes|ji|sahi|save|thik)\b/i.test(lower)) {
          if (slots.confidence_score < 0.85 || lowConfidenceFields.length > 0) {
            showToast('Verify amber low-confidence field before saving', 'warn');
            return;
          }
          void finalizeAndSave(slots, rawTranscript, redFlagsTriggered);
        }
        return;
      }

      if (context === 'edit' && slots && editingField) {
        if (editingField === 'duration_days') {
          const d = extractDurationDays(clean);
          if (d !== null) {
            const updated: ClinicalSlots = {
              ...slots,
              duration_days: d,
              confidence_score: 0.96,
              requires_clinician_review: false,
            };
            setSlots(updated);
            setLowConfidenceFields((prev) => prev.filter((f) => f !== 'duration_days'));
            setEditingField(null);
            speakReadback(updated, activeLang);
          }
        } else if (editingField === 'primary_symptom') {
          const parsed = parseClinicalUtterance(clean, { snrDb: liveSnrRef.current });
          const updated: ClinicalSlots = {
            ...slots,
            primary_symptom: parsed.slots.primary_symptom,
            severity_grade: parsed.slots.severity_grade,
            confidence_score: 0.96,
            requires_clinician_review: false,
          };
          setSlots(updated);
          setRedFlagsTriggered(parsed.redFlagsTriggered);
          setLowConfidenceFields((prev) => prev.filter((f) => f !== 'primary_symptom'));
          setEditingField(null);
          speakReadback(updated, activeLang);
        }
        return;
      }

      setRawTranscript(clean);
      const parsed = parseClinicalUtterance(clean, {
        snrDb: simOpts?.snrDb ?? liveSnrRef.current,
        overrideConfidence: simOpts?.overrideConfidence,
        lowConfidenceFields: simOpts?.lowConfidenceFields,
      });

      if (
        parsed.slots.primary_symptom === 'none' &&
        parsed.redFlagsTriggered.length === 0 &&
        parsed.slots.resolved_symptoms.length === 0 &&
        parsed.slots.negated_symptoms.length === 0
      ) {
        setRawTranscript(clean);
        showToast('No symptom detected — please state your symptom or tap an icon', 'warn');
        triggerAcousticStrike(activeLang);
        return;
      }

      setSlots(parsed.slots);
      setLowConfidenceFields(parsed.lowConfidenceFields);
      setNormalizedTokens(parsed.normalizedTokens);
      setRedFlagsTriggered(parsed.redFlagsTriggered);
      setStrikeBanner(null);

      if (parsed.slots.duration_days === null) {
        setAwaitingDuration(true);
        speakPrompt('duration', LANGUAGE_META[activeLang].durationPrompt, activeLang);
        return;
      }

      setAwaitingDuration(false);
      setStep(3);
      speakReadback(parsed.slots, activeLang);
    },
    [
      editingField,
      finalizeAndSave,
      handleDeclineConsent,
      handleGrantConsent,
      lang,
      lowConfidenceFields.length,
      rawTranscript,
      redFlagsTriggered,
      showToast,
      slots,
      speakPrompt,
      speakReadback,
      triggerAcousticStrike,
    ]
  );

  const processUtteranceRef = useRef(processUtterance);
  useEffect(() => {
    processUtteranceRef.current = processUtterance;
  }, [processUtterance]);

  // ==========================================================================
  // DEDICATED VITE MODULE WEB WORKER LOADER
  // ==========================================================================

  const clearWorkerWatchdog = useCallback(() => {
    if (workerWatchdogRef.current !== null) {
      window.clearTimeout(workerWatchdogRef.current);
      workerWatchdogRef.current = null;
    }
  }, []);

  const loadWhisperWorker = useCallback(() => {
    if (workerState === 'loading' || workerState === 'ready') return;
    try {
      if (!workerRef.current) {
        const worker = new Worker(new URL('./workers/asr.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event) => {
          const msg = event.data || {};
          if (msg.type === 'status') {
            setWorkerState(msg.state);
            if (typeof msg.progress === 'number') setWorkerProgress(msg.progress);
            if (msg.state === 'ready') {
              clearWorkerWatchdog();
              void refreshCacheStatus();
            }
          } else if (msg.type === 'result') {
            clearWorkerWatchdog();
            setLastDecodeMs(msg.elapsedMs ?? null);
            processUtteranceRef.current(msg.text || '', pendingWorkerContextRef.current, {
              snrDb: liveSnrRef.current,
            });
          } else if (msg.type === 'error') {
            clearWorkerWatchdog();
            setWorkerState('error');
            showToast(`Worker: ${msg.message}`, 'warn');
          }
        };
        worker.onerror = () => {
          clearWorkerWatchdog();
          setWorkerState('error');
          showToast('Worker failed — switch to Browser Speech or Simulator', 'warn');
        };
        workerRef.current = worker;
      }
      setWorkerState('loading');
      setWorkerProgress(4);
      workerRef.current.postMessage({ type: 'load' });
    } catch {
      setWorkerState('error');
      showToast('Module Web Worker unsupported in this browser', 'warn');
    }
  }, [clearWorkerWatchdog, refreshCacheStatus, showToast, workerState]);

  const dispatchPcmToWorker = useCallback(
    (pcm16k: Float32Array, context: ListenContext) => {
      if (!workerRef.current || pcm16k.length === 0) return;
      pendingWorkerContextRef.current = context;
      setWorkerState('decoding');
      clearWorkerWatchdog();
      workerWatchdogRef.current = window.setTimeout(() => {
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        setWorkerState('error');
        showToast('Whisper worker timed out (30s) — recreated worker', 'warn');
        loadWhisperWorker();
      }, 30_000);

      workerRef.current.postMessage(
        {
          type: 'transcribe',
          audio: pcm16k,
          language: LANGUAGE_META[lang].whisperLang,
        },
        [pcm16k.buffer]
      );
    },
    [clearWorkerWatchdog, lang, loadWhisperWorker, showToast]
  );

  // ==========================================================================
  // DUAL-ENGINE MIC CAPTURE (ZERO AUDIO-FOCUS COLLISION)
  // ==========================================================================

  const toggleMicCapture = async (context: ListenContext) => {
    if (isRecording) {
      if (
        asrEngine === 'whisper_worker' &&
        workerState === 'ready' &&
        workerRef.current &&
        whisperSessionRef.current
      ) {
        const pcm16k = whisperSessionRef.current.stopAndExtract16kHz();
        whisperSessionRef.current = null;
        setIsRecording(false);
        setEqBars([18, 24, 18, 28, 20, 24, 18, 22, 18, 16]);
        if (pcm16k.length > 0) {
          dispatchPcmToWorker(pcm16k, context);
          return;
        }
      }
      const buffered = speechBufferRef.current.trim();
      speechBufferRef.current = '';
      stopAudioHardware();
      if (buffered) {
        setTypedInput('');
        processUtteranceRef.current(buffered, speechContextRef.current, { snrDb: 19 });
      }
      return;
    }

    const SpeechRecCtor =
      typeof window !== 'undefined'
        ? ((window as unknown as Record<string, unknown>).SpeechRecognition ||
            (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
        : null;

    setListenMode(context);
    setIsRecording(true);
    voiceEngine.stopSpeaking();

    if (asrEngine === 'whisper_worker' && workerState === 'ready') {
      try {
        const session = await startWhisperDspCapture({
          onSnrUpdate: (snr) => {
            liveSnrRef.current = snr;
            setLiveSnrDb(snr);
          },
          onEqBarsUpdate: (bars) => setEqBars(bars),
          onMaxDurationReached: (pcm16k) => {
            whisperSessionRef.current = null;
            setIsRecording(false);
            setEqBars([18, 24, 18, 28, 20, 24, 18, 22, 18, 16]);
            showToast('60s recording cap reached — decoding audio');
            dispatchPcmToWorker(pcm16k, context);
          },
        });
        whisperSessionRef.current = session;
      } catch {
        stopAudioHardware();
        showToast('Mic permission blocked — use Simulate sheet or type below', 'warn');
      }
      return;
    }

    if (!SpeechRecCtor) {
      stopAudioHardware();
      if (asrEngine === 'whisper_worker') {
        setEngineDrawerOpen(true);
        showToast('Download Offline Whisper model or use Simulate sheet', 'warn');
      } else {
        showToast('Browser Speech API unavailable — use Offline Whisper or Simulate', 'warn');
      }
      return;
    }

    let tick = 0;
    const animateSafeWave = () => {
      tick += 0.22;
      setEqBars(
        Array.from({ length: 10 }, (_, idx) =>
          Math.round(22 + Math.abs(Math.sin(tick + idx * 0.65)) * 68)
        )
      );
      animFrameRef.current = requestAnimationFrame(animateSafeWave);
    };
    animateSafeWave();

    try {
      const rec = new (SpeechRecCtor as new () => BrowserSpeechRecognition)();
      recognitionRef.current = rec;
      speechBufferRef.current = '';
      speechContextRef.current = context;
      rec.lang = LANGUAGE_META[lang].bcp47;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      const finalizeSpeechBuffer = () => {
        const text = speechBufferRef.current.trim();
        speechBufferRef.current = '';
        stopAudioHardware();
        if (text) {
          setTypedInput('');
          processUtteranceRef.current(text, context, { snrDb: 19 });
        } else {
          triggerAcousticStrike(lang);
        }
      };

      rec.onresult = (event) => {
        if (!event.results) return;
        let finalPart = '';
        let interimPart = '';
        for (let i = 0; i < event.results.length; i += 1) {
          const res = event.results[i];
          const chunk = res?.[0]?.transcript || '';
          if (res?.isFinal) finalPart += `${chunk} `;
          else interimPart += `${chunk} `;
        }
        const combined = `${finalPart}${interimPart}`.trim();
        speechBufferRef.current = combined;
        if (combined) setTypedInput(combined);

        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(finalizeSpeechBuffer, 2800);
      };
      rec.onerror = () => {
        const text = speechBufferRef.current.trim();
        speechBufferRef.current = '';
        stopAudioHardware();
        if (text) {
          setTypedInput('');
          processUtteranceRef.current(text, context, { snrDb: 19 });
        } else {
          showToast('Speech capture ended — tap mic again or type below', 'warn');
        }
      };
      rec.onend = () => {
        const text = speechBufferRef.current.trim();
        if (text) {
          speechBufferRef.current = '';
          stopAudioHardware();
          setTypedInput('');
          processUtteranceRef.current(text, context, { snrDb: 19 });
        } else {
          stopAudioHardware();
        }
      };
      rec.start();
    } catch {
      stopAudioHardware();
      showToast('Mic unavailable — use Simulate sheet', 'warn');
    }
  };

  const handleCompleteVisualFallback = () => {
    const built: ClinicalSlots = {
      primary_symptom: tapSymptom,
      secondary_symptoms: [],
      resolved_symptoms: [],
      negated_symptoms: [],
      duration_days: tapDuration,
      severity_grade: tapSymptom === 'shortness_of_breath' ? 'severe' : 'moderate',
      spoken_vitals: { bp: null, temperature: null, sugar: null, medications: [] },
      confidence_score: 1.0,
      requires_clinician_review: false,
    };
    setRawTranscript(`[Visual Fallback] ${getSymptomDisplay(tapSymptom, lang).en}, ${tapDuration}d`);
    setSlots(built);
    setLowConfidenceFields([]);
    setRedFlagsTriggered([]);
    setNormalizedTokens([`tap:${tapSymptom}`, `duration:${tapDuration}d`]);
    setStep(3);
    speakReadback(built);
  };

  const handleCopyEsanjeevani = async (rec: DecryptedEncounter) => {
    const { stored, pii } = rec;
    const primary = getSymptomDisplay(stored.slots.primary_symptom, stored.language).en;
    const secondary =
      stored.slots.secondary_symptoms.length > 0
        ? stored.slots.secondary_symptoms
            .map((s) => getSymptomDisplay(s, stored.language).en)
            .join(', ')
        : 'None';
    const resolved =
      stored.slots.resolved_symptoms.length > 0
        ? stored.slots.resolved_symptoms
            .map((s) => getSymptomDisplay(s, stored.language).en)
            .join(', ')
        : 'None';
    const negated =
      stored.slots.negated_symptoms.length > 0
        ? stored.slots.negated_symptoms
            .map((s) => getSymptomDisplay(s, stored.language).en)
            .join(', ')
        : 'None';

    const text = [
      `eSANJEEVANI DOCTOR TRIAGE SLIP [${stored.encounter_id}]`,
      `Patient: ${pii.patient.name} (${pii.patient.age}y / ${pii.patient.sex})${
        pii.patient.abha_id ? ` | ABHA: ${pii.patient.abha_id}` : ''
      }`,
      `Language: ${LANGUAGE_META[stored.language].name} | Consent: ${pii.consent_timestamp}`,
      `ACTIVE: ${primary} (${stored.slots.duration_days ?? 1}d) | Secondary: ${secondary}`,
      `RESOLVED HISTORY: ${resolved}`,
      `NEGATED: ${negated}`,
      `SEVERITY: ${stored.slots.severity_grade.toUpperCase()}`,
      `Transcript: "${pii.raw_transcript}"`,
      `Designed with reference to ICMR 2023 & DPDP · Intake structuring only · No autonomous diagnosis.`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard restriction
    }
    showToast(`Copied eSanjeevani Slip · ${stored.encounter_id.slice(0, 8)}`);
  };

  // ==========================================================================
  // 7 DETERMINISTIC OFFLINE SIMULATOR SCENARIOS
  // ==========================================================================

  const runScenario = (id: ScenarioId) => {
    stopAudioHardware();
    const now = new Date().toISOString();
    setActiveDraftId(globalThis.crypto.randomUUID());
    setView('intake');
    setManualTapMode(false);
    setEditingField(null);
    setSavedRecordId(null);
    setConsentTimestamp(now);
    setConsentMode('verbal_granted');
    setSimSheetOpen(false);

    if (id === 1) {
      setLang('hinglish');
      setStrikeCount(0);
      setStep(2);
      processUtterance('Bukhar nahi hai par seene mein tez dard hai do din se', 'symptom', {
        langOverride: 'hinglish',
        snrDb: 20,
      });
    } else if (id === 2) {
      setLang('hinglish');
      setStrikeCount(0);
      setStep(2);
      processUtterance('Bukhar toh kal utar gaya, ab bas chhati bhari lag rahi hai', 'symptom', {
        langOverride: 'hinglish',
        snrDb: 21,
      });
    } else if (id === 3) {
      setLang('bn');
      setStrikeCount(0);
      setStep(2);
      processUtterance(
        'Jor kal chhilo ekhon nei, buker bhetor chap lagche, BP 148/92',
        'symptom',
        { langOverride: 'bn', snrDb: 20 }
      );
    } else if (id === 4) {
      setLang('hinglish');
      setStrikeCount(0);
      setStep(2);
      processUtterance('Patient ko tej bukhar aur chakkar aana hai', 'symptom', {
        langOverride: 'hinglish',
        snrDb: 19,
      });
    } else if (id === 5) {
      setLang('hinglish');
      setStrikeCount(1);
      liveSnrRef.current = 6;
      setLiveSnrDb(6);
      setStrikeBanner('Low SNR (6 dB) · Confidence 72% — Escalate for clinician review.');
      setStep(2);
      processUtterance('Patient ko teen din se tej bukhar hai', 'symptom', {
        snrDb: 6,
        overrideConfidence: 0.72,
        lowConfidenceFields: ['duration_days'],
        langOverride: 'hinglish',
      });
    } else if (id === 6) {
      setLang('hi');
      setStrikeCount(2);
      setStrikeBanner('Strike 2 of 2 · Persistent clinic noise. Switched to visual icon fallback.');
      setStep(2);
      setAwaitingDuration(false);
      speakPrompt('visual_fallback', LANGUAGE_META.hi.visualFallbackPrompt, 'hi');
    } else if (id === 7) {
      setLang('bn');
      setStrikeCount(0);
      handleDeclineConsent('bn');
    }
  };

  if (bootingVault) {
    return (
      <div className="min-h-screen w-full bg-[#E8E6DF] flex items-center justify-center">
        <span className="font-mono text-xs text-[#6E6D68]">Starting Encrypted Session…</span>
      </div>
    );
  }

  if (!vaultUnlocked || showPassphraseSetup) {
    return (
      <PinLockGate
        onUnlocked={() => void handleVaultUnlocked()}
        onCancel={
          showPassphraseSetup && !vaultInitialized
            ? () => setShowPassphraseSetup(false)
            : undefined
        }
      />
    );
  }

  const latestDraft = records.find((r) => r.stored.sync_status === 'DRAFT');
  const pendingCount = records.filter(
    (r) => r.stored.sync_status === 'QUEUED' || r.stored.sync_status === 'FAILED_RETRYABLE'
  ).length;
  const isLowConfidenceBlocked =
    slots !== null && (slots.confidence_score < 0.85 || lowConfidenceFields.length > 0);
  const isRedFlagActive =
    slots !== null &&
    (redFlagsTriggered.length > 0 || slots.severity_grade === 'critical_red_flag');

  return (
    <div
      className="min-h-screen w-full bg-[#E8E6DF] text-[#111111] flex items-start sm:items-center justify-center sm:py-8 sm:px-4 antialiased selection:bg-[#EAF1F0] selection:text-[#0F3D3E]"
      style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      <div className="relative w-full max-w-[430px] min-h-screen sm:min-h-[820px] sm:max-h-[880px] bg-[#F6F5F1] sm:rounded-[36px] sm:border sm:border-[#E2E0D8] sm:shadow-[0_24px_60px_-20px_rgba(17,17,17,0.16)] flex flex-col overflow-hidden">
        {/* ================================================================ */}
        {/* CLEAN TOP HEADER                                                 */}
        {/* ================================================================ */}
        <header className="sticky top-0 z-20 bg-[#F6F5F1]/90 backdrop-blur-md border-b border-[#E2E0D8] px-4 h-16 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                stopAudioHardware();
                setView('home');
              }}
              className="flex items-baseline gap-1 text-left focus:outline-none"
            >
              <span className="text-[16px] font-semibold tracking-[-0.03em] text-[#111111]">
                BhashaSetu
              </span>
              <span className="font-mono text-[9px] font-medium tracking-[0.08em] text-[#6E6D68] border border-[#E2E0D8] rounded px-1 py-0.5 uppercase">
                EDGE
              </span>
            </button>

            <button
              onClick={() => setIcmrModalOpen(true)}
              className="h-6 px-2 rounded-full bg-[#EAF1F0] text-[#0F3D3E] font-mono text-[9px] font-semibold tracking-[0.06em] uppercase hover:bg-[#0F3D3E] hover:text-white transition"
            >
              ICMR
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleLockVault}
              aria-label="Lock AES-256-GCM Vault"
              title="Lock Vault (wipe RAM DEK)"
              className="w-8 h-8 rounded-full bg-white border border-[#E2E0D8] text-[#111111] hover:border-[#C84B31] hover:text-[#C84B31] flex items-center justify-center transition"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setEngineDrawerOpen((prev) => !prev)}
              aria-label="Open ASR & PWA Engine Drawer"
              className={`w-8 h-8 rounded-full border flex items-center justify-center transition ${
                engineDrawerOpen
                  ? 'bg-[#111111] border-[#111111] text-white'
                  : workerState === 'ready'
                  ? 'bg-[#EAF1F0] border-[#0F3D3E]/25 text-[#0F3D3E]'
                  : 'bg-white border-[#E2E0D8] text-[#111111] hover:border-[#111111]/25'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => {
                const next = !isOnline;
                setIsOnline(next);
                showToast(
                  next ? 'Online · ABDM FHIR sync enabled' : 'Offline · Encrypted IndexedDB'
                );
              }}
              className="h-8 px-2.5 rounded-full bg-white border border-[#E2E0D8] flex items-center gap-1.5 text-[10px] font-mono font-medium text-[#111111] transition hover:border-[#111111]/25"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isOnline ? 'bg-[#0F3D3E]' : 'bg-[#B45309]'
                }`}
              />
              <span>{isOnline ? 'ON' : 'OFF'}</span>
            </button>

            <button
              onClick={() => {
                const nextMuted = !ttsMuted;
                voiceEngine.setMuted(nextMuted);
                setTtsMuted(nextMuted);
              }}
              aria-label={ttsMuted ? 'Unmute audio readback' : 'Mute audio readback'}
              className={`w-8 h-8 rounded-full border flex items-center justify-center transition ${
                ttsMuted
                  ? 'bg-transparent border-[#E2E0D8] text-[#A3A19B]'
                  : isSpeaking
                  ? 'bg-[#EAF1F0] border-[#0F3D3E]/30 text-[#0F3D3E]'
                  : 'bg-white border-[#E2E0D8] text-[#111111] hover:border-[#111111]/25'
              }`}
            >
              {ttsMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>

        {engineDrawerOpen && (
          <EngineDrawer
            asrEngine={asrEngine}
            onSelectEngine={setAsrEngine}
            workerState={workerState}
            workerProgress={workerProgress}
            lastDecodeMs={lastDecodeMs}
            liveSnrDb={liveSnrDb}
            swStatus={swStatus}
            cacheBuckets={cacheBuckets}
            storageInfo={storageInfo}
            neuralVoiceState={neuralVoiceState}
            neuralVoiceProgress={neuralVoiceProgress}
            neuralVoiceLang={neuralVoiceLang}
            onLoadNeuralVoice={() => void handleLoadNeuralVoice()}
            onRefreshCache={refreshCacheStatus}
            onLoadWorker={loadWhisperWorker}
            onClose={() => setEngineDrawerOpen(false)}
          />
        )}

        {quotaBanner && (
          <div className="bg-[#FEF2F2] border-b border-[#C84B31]/25 px-5 py-2.5 flex items-center justify-between gap-2 text-[11px] text-[#991B1B] shrink-0">
            <span>{quotaBanner}</span>
            <button onClick={() => setQuotaBanner(null)} className="text-[#C84B31]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {toast && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-40px)] max-w-[360px] pointer-events-none">
            <div
              className={`px-3.5 py-2.5 rounded-xl text-xs font-medium tracking-[-0.01em] flex items-center gap-2 shadow-[0_8px_24px_rgba(17,17,17,0.12)] border ${
                toast.tone === 'warn'
                  ? 'bg-[#FFFBEB] text-[#B45309] border-[#B45309]/25'
                  : 'bg-[#111111] text-[#F6F5F1] border-[#111111]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  toast.tone === 'warn' ? 'bg-[#B45309]' : 'bg-[#EAF1F0]'
                }`}
              />
              <span className="truncate">{toast.text}</span>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SCROLLABLE MAIN CANVAS                                           */}
        {/* ================================================================ */}
        <main className="flex-1 overflow-y-auto px-5 pt-6 pb-28">
          {view === 'home' && (
            <div className="space-y-8">
              <div className="space-y-2 pt-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
                  Envelope DEK · Worker WASM · ABDM FHIR R4
                </p>
                <h1 className="text-[30px] leading-[1.12] font-semibold tracking-[-0.03em] text-[#111111]">
                  Select patient language.
                </h1>
                <p className="text-[14px] leading-relaxed text-[#6E6D68]">
                  Single-tap acoustic lock. Zero auto-detect latency for rural clinics.
                </p>
              </div>

              <div className="space-y-3">
                {!vaultInitialized && (
                  <button
                    onClick={() => setShowPassphraseSetup(true)}
                    className="w-full bg-[#EAF1F0]/75 hover:bg-[#EAF1F0] rounded-2xl border border-[#0F3D3E]/20 px-4 py-2.5 flex items-center justify-between text-left transition"
                  >
                    <span className="font-mono text-[10px] font-medium text-[#0F3D3E] inline-flex items-center gap-1.5">
                      <Lock className="w-3 h-3 shrink-0" />
                      <span>Session Encryption Active · Set Passphrase to Lock</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#0F3D3E] shrink-0" />
                  </button>
                )}

                {latestDraft && (
                  <button
                    onClick={() => resumeDraftEncounter(latestDraft)}
                    className="w-full bg-[#FFFBEB] hover:bg-[#FEF3C7] rounded-2xl border border-[#B45309]/30 px-4 py-3 flex items-center justify-between text-left transition"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#B45309] font-semibold">
                        Encrypted Draft Saved · Resume Intake
                      </div>
                      <div className="text-[13px] font-medium text-[#111111] truncate mt-0.5">
                        {getSymptomDisplay(latestDraft.stored.slots.primary_symptom, latestDraft.stored.language).en}
                        {latestDraft.pii.patient.name ? ` · ${latestDraft.pii.patient.name}` : ''}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#B45309] shrink-0" />
                  </button>
                )}

                {(['hi', 'hinglish', 'bn'] as LanguageCode[]).map((code) => {
                  const item = LANGUAGE_META[code];
                  return (
                    <button
                      key={code}
                      onClick={() => startLanguageIntake(code)}
                      className="w-full bg-white rounded-2xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] hover:border-[#0F3D3E]/40 active:scale-[0.99] transition px-5 py-6 flex items-center justify-between text-left group"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-[#111111] group-hover:text-[#0F3D3E] transition">
                            {item.nativeScript}
                          </span>
                          <span className="font-mono text-[10px] tracking-[0.06em] text-[#A3A19B] uppercase">
                            {item.codeLabel}
                          </span>
                        </div>
                        <p className="text-[13px] text-[#6E6D68]">{item.sublabel}</p>
                      </div>
                      <div className="w-9 h-9 rounded-full bg-[#F6F5F1] group-hover:bg-[#0F3D3E] text-[#111111] group-hover:text-white flex items-center justify-center transition">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-[#E2E0D8] grid grid-cols-3 gap-4">
                <div>
                  <div className="font-mono tabular-nums text-[15px] font-semibold text-[#111111]">
                    {pendingCount}
                  </div>
                  <div className="text-[11px] text-[#6E6D68] mt-0.5">Split FHIR queue</div>
                </div>
                <div>
                  <div className="font-mono tabular-nums text-[15px] font-semibold text-[#0F3D3E]">
                    AES-256
                  </div>
                  <div className="text-[11px] text-[#6E6D68] mt-0.5">600k PBKDF2 DEK</div>
                </div>
                <div>
                  <div className="font-mono tabular-nums text-[15px] font-semibold text-[#111111]">
                    {workerState === 'ready' ? 'WASM' : 'READY'}
                  </div>
                  <div className="text-[11px] text-[#6E6D68] mt-0.5">Off-thread SLU</div>
                </div>
              </div>
            </div>
          )}

          {view === 'intake' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    stopAudioHardware();
                    setView('home');
                  }}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#6E6D68] hover:text-[#111111] transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{LANGUAGE_META[lang].name}</span>
                </button>

                <div className="flex items-center gap-2" aria-label={`Step ${step} of 4`}>
                  {([1, 2, 3, 4] as IntakeStep[]).map((dot) => (
                    <span
                      key={dot}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        dot === step
                          ? 'w-5 bg-[#0F3D3E]'
                          : dot < step
                          ? 'w-1.5 bg-[#0F3D3E]/50'
                          : 'w-1.5 bg-[#111111]/[0.14]'
                      }`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => startLanguageIntake(lang)}
                  className="text-[12px] font-medium text-[#6E6D68] hover:text-[#111111] inline-flex items-center gap-1 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              <button
                onClick={() => setPatientModalOpen(true)}
                className="w-full bg-white rounded-2xl border border-[#E2E0D8] px-3.5 py-2.5 flex items-center justify-between text-left hover:border-[#0F3D3E]/30 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-[#F6F5F1] text-[#0F3D3E] flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-[#111111] truncate">
                      {patient.name || 'Add Patient Identity'}
                      {patient.age ? ` · ${patient.age}y / ${patient.sex}` : ''}
                    </div>
                    <div className="font-mono text-[10px] text-[#6E6D68] truncate">
                      {patient.abha_id
                        ? `ABHA ${patient.abha_id}`
                        : 'Optional ABHA ID · Encrypted via DEK'}
                    </div>
                  </div>
                </div>
                <Edit3 className="w-3.5 h-3.5 text-[#A3A19B] shrink-0" />
              </button>

              {ttsPackMissing && lastSpoken && (
                <div className="bg-[#EAF1F0]/80 border border-[#0F3D3E]/20 rounded-2xl px-4 py-2.5 flex items-start gap-2.5">
                  <VolumeX className="w-3.5 h-3.5 text-[#0F3D3E] shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-snug text-[#0F3D3E]">
                    <span className="font-mono uppercase text-[9px] font-semibold block">
                      {LANGUAGE_META[lang].bcp47} TTS Pack Unavailable · Visual Readback
                    </span>
                    “{lastSpoken}”
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5 pt-1">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
                      <MicOff className="w-3 h-3 text-[#B45309]" />
                      <span>Step 01 · Clinical Mic Locked</span>
                    </div>
                    <h2 className="text-[25px] leading-[1.2] font-semibold tracking-[-0.03em] text-[#111111]">
                      “{LANGUAGE_META[lang].consentPrompt}”
                    </h2>
                  </div>

                  <div className="bg-white rounded-2xl border border-[#E2E0D8] p-4 flex items-center justify-between">
                    <button
                      onClick={() => speakPrompt('consent', LANGUAGE_META[lang].consentPrompt)}
                      className="inline-flex items-center gap-2 text-[12px] font-medium text-[#6E6D68] hover:text-[#111111] transition"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-[#0F3D3E]" />
                      <span>Replay prompt</span>
                    </button>

                    <button
                      onClick={() => toggleMicCapture('consent')}
                      className={`h-8 px-3 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition ${
                        isRecording && listenMode === 'consent'
                          ? 'bg-[#C84B31] text-white'
                          : 'bg-[#F6F5F1] text-[#111111] hover:bg-[#EAF1F0]'
                      }`}
                    >
                      <Mic className="w-3.5 h-3.5" />
                      <span>
                        {isRecording && listenMode === 'consent' ? 'Listening…' : 'Speak reply'}
                      </span>
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      onClick={handleGrantConsent}
                      className="w-full h-14 rounded-2xl bg-[#0F3D3E] hover:bg-[#0B2F30] active:scale-[0.99] text-white text-[15px] font-medium tracking-[-0.01em] flex items-center justify-center gap-2 transition"
                    >
                      <Check className="w-4 h-4" />
                      <span>{LANGUAGE_META[lang].confirmWord} · Confirm Consent</span>
                    </button>

                    <button
                      onClick={() => handleDeclineConsent()}
                      className="w-full h-12 rounded-2xl bg-white hover:bg-[#F6F5F1] border border-[#E2E0D8] text-[#6E6D68] hover:text-[#111111] text-[13px] font-medium flex items-center justify-center gap-2 transition"
                    >
                      <span>{LANGUAGE_META[lang].declineWord} · Tap-Only Fallback</span>
                    </button>
                  </div>

                  <div className="bg-white/70 rounded-2xl border border-[#E2E0D8] px-4 py-3 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-[#0F3D3E] shrink-0 mt-0.5" />
                    <p className="text-[11px] leading-relaxed text-[#6E6D68]">
                      <span className="font-semibold text-[#111111]">
                        Designed with reference to ICMR 2023 &amp; DPDP:
                      </span>{' '}
                      Structures symptoms for clinician review only. Never diagnoses or prescribes.
                      PII is encrypted with your envelope DEK; FHIR sync is coarse-dated &amp; anonymized.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#6E6D68] px-1">
                    <span>
                      {consentMode === 'verbal_granted'
                        ? `CONSENT LOGGED · ${
                            asrEngine === 'whisper_worker' ? 'WORKER WASM' : 'BROWSER ASR'
                          }`
                        : 'AUDIO DECLINED · TAP-ONLY'}
                    </span>
                    <span className="tabular-nums">
                      {consentTimestamp
                        ? new Date(consentTimestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>

                  {strikeBanner && (
                    <div className="bg-[#FFFBEB] border border-[#B45309]/25 rounded-2xl px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
                      <p className="text-[12px] leading-snug text-[#B45309] font-medium">
                        {strikeBanner}
                      </p>
                    </div>
                  )}

                  {manualTapMode || strikeCount >= 2 ? (
                    <div className="bg-white rounded-2xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] p-5 space-y-6">
                      <div className="space-y-1">
                        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#B45309]">
                          Zero-Typing Fallback
                        </p>
                        <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-[#111111]">
                          Select symptom &amp; duration
                        </h3>
                      </div>

                      <div className="grid grid-cols-3 gap-2.5">
                        {[
                          {
                            id: 'fever',
                            label: 'Fever',
                            sub: lang === 'bn' ? 'জ্বর' : 'बुखार',
                            icon: Thermometer,
                          },
                          {
                            id: 'abdominal_pain',
                            label: 'Pain',
                            sub: lang === 'bn' ? 'ব্যথা' : 'दर्द',
                            icon: HeartPulse,
                          },
                          {
                            id: 'shortness_of_breath',
                            label: 'Breathing',
                            sub: lang === 'bn' ? 'শ্বাস' : 'साँस',
                            icon: Wind,
                          },
                        ].map((card) => {
                          const Icon = card.icon;
                          const active = tapSymptom === card.id;
                          return (
                            <button
                              key={card.id}
                              onClick={() => setTapSymptom(card.id)}
                              className={`py-4 px-2 rounded-2xl border flex flex-col items-center gap-1.5 transition ${
                                active
                                  ? 'bg-[#EAF1F0] border-[#0F3D3E] text-[#0F3D3E]'
                                  : 'bg-[#F6F5F1]/60 border-[#E2E0D8] text-[#111111] hover:border-[#111111]/25'
                              }`}
                            >
                              <Icon className="w-5 h-5" />
                              <span className="text-[13px] font-semibold tracking-[-0.01em]">
                                {card.label}
                              </span>
                              <span className="text-[11px] text-[#6E6D68]">{card.sub}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
                          Duration
                        </span>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '1 day', days: 1 },
                            { label: '2–3 days', days: 2 },
                            { label: '1 week+', days: 7 },
                          ].map((chip) => {
                            const active = tapDuration === chip.days;
                            return (
                              <button
                                key={chip.days}
                                onClick={() => setTapDuration(chip.days)}
                                className={`h-11 rounded-xl border text-[12px] font-medium transition ${
                                  active
                                    ? 'bg-[#0F3D3E] text-white border-[#0F3D3E]'
                                    : 'bg-white text-[#111111] border-[#E2E0D8] hover:border-[#111111]/25'
                                }`}
                              >
                                {chip.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        onClick={handleCompleteVisualFallback}
                        className="w-full h-12 rounded-2xl bg-[#0F3D3E] hover:bg-[#0B2F30] text-white text-[14px] font-medium flex items-center justify-center gap-2 transition"
                      >
                        <span>Review Structured Summary</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white rounded-3xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] px-5 py-7 space-y-6">
                      {awaitingDuration && slots && (
                        <div className="bg-[#EAF1F0]/70 border border-[#0F3D3E]/20 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#0F3D3E]">
                              Missing Slot · Duration
                            </span>
                            <Clock className="w-3.5 h-3.5 text-[#0F3D3E]" />
                          </div>
                          <p className="text-[16px] font-semibold tracking-[-0.02em] text-[#111111]">
                            “{LANGUAGE_META[lang].durationPrompt}”
                          </p>
                          <div className="flex gap-2">
                            {[
                              { text: lang === 'bn' ? '1 din dhore' : '1 din se', label: '1 day' },
                              { text: lang === 'bn' ? '2 din dhore' : 'Do din se', label: '2 days' },
                              { text: lang === 'bn' ? '3 din dhore' : 'Teen din se', label: '3 days' },
                            ].map((q) => (
                              <button
                                key={q.label}
                                onClick={() => processUtterance(q.text, 'duration')}
                                className="flex-1 h-9 rounded-xl bg-white border border-[#0F3D3E]/20 text-[12px] font-medium text-[#0F3D3E] hover:bg-[#0F3D3E] hover:text-white transition"
                              >
                                {q.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col items-center justify-center py-3">
                        <div className="relative flex items-center justify-center">
                          {isRecording && (
                            <>
                              <span className="absolute w-36 h-36 rounded-full border border-[#C84B31]/20 animate-ping" />
                              <span className="absolute w-28 h-28 rounded-full border border-[#C84B31]/35" />
                            </>
                          )}
                          <button
                            onClick={() =>
                              toggleMicCapture(awaitingDuration ? 'duration' : 'symptom')
                            }
                            aria-label="Toggle voice capture"
                            className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 ${
                              isRecording
                                ? 'bg-[#C84B31] text-white scale-[1.03] shadow-[0_12px_30px_rgba(200,75,49,0.28)]'
                                : workerState === 'decoding'
                                ? 'bg-[#111111] text-white'
                                : 'bg-[#0F3D3E] hover:bg-[#0B2F30] text-white shadow-[0_8px_24px_rgba(15,61,62,0.18)]'
                            }`}
                          >
                            {workerState === 'decoding' ? (
                              <Activity className="w-8 h-8 animate-pulse" />
                            ) : (
                              <Mic className="w-8 h-8 stroke-[1.75]" />
                            )}
                          </button>
                        </div>

                        <p className="text-[13px] font-medium text-[#111111] mt-5 tracking-[-0.01em]">
                          {workerState === 'decoding'
                            ? 'Worker Thread decoding 16kHz PCM…'
                            : isRecording
                            ? asrEngine === 'whisper_worker'
                              ? `Recording · 100–3400Hz DSP · SNR ${liveSnrDb} dB`
                              : 'Listening · Browser Speech API'
                            : awaitingDuration
                            ? 'Tap to speak duration'
                            : 'Tap to capture symptoms'}
                        </p>

                        <div className="flex items-end justify-center gap-1.5 h-8 mt-4">
                          {eqBars.map((heightPct, i) => (
                            <span
                              key={i}
                              style={{ height: `${isRecording ? heightPct : 16}%` }}
                              className={`w-[3px] rounded-full transition-all duration-100 ${
                                isRecording ? 'bg-[#C84B31]' : 'bg-[#111111]/[0.14]'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      {rawTranscript && (
                        <div className="border-t border-[#E2E0D8] pt-4 space-y-2.5">
                          <p className="text-[13px] text-[#111111] leading-relaxed">
                            “{rawTranscript}”
                          </p>
                          {normalizedTokens.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {normalizedTokens.map((tok, idx) => (
                                <span
                                  key={idx}
                                  className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#F6F5F1] text-[#6E6D68] border border-[#E2E0D8]"
                                >
                                  {tok}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const check = validateTranscriptInput(typedInput);
                          if (!check.valid) {
                            setTranscriptError(check.error || 'Invalid transcript');
                            return;
                          }
                          if (!check.sanitized) return;
                          setTranscriptError(null);
                          processUtterance(
                            check.sanitized,
                            awaitingDuration ? 'duration' : 'symptom'
                          );
                          setTypedInput('');
                        }}
                        className="space-y-1.5 pt-1"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={typedInput}
                            onChange={(e) => {
                              setTypedInput(e.target.value);
                              if (transcriptError) setTranscriptError(null);
                            }}
                            placeholder={
                              awaitingDuration
                                ? 'Type duration (e.g. 3 din se)'
                                : 'Or enter Hindi / Hinglish / Bengali phrase…'
                            }
                            className="flex-1 h-10 bg-[#F6F5F1] border border-[#E2E0D8] rounded-xl px-3 text-[12px] text-[#111111] placeholder:text-[#A3A19B] focus:outline-none focus:border-[#0F3D3E]"
                          />
                          <button
                            type="submit"
                            className="h-10 px-3.5 rounded-xl bg-[#111111] text-white text-[12px] font-medium hover:bg-[#2A2A2A] transition"
                          >
                            Parse
                          </button>
                        </div>
                        {transcriptError && (
                          <p className="text-[11px] text-[#C84B31] font-medium">{transcriptError}</p>
                        )}
                      </form>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && slots && (
                <div className="space-y-4">
                  {isRedFlagActive && (
                    <div className="bg-[#FEF2F2] border border-[#C84B31]/30 rounded-2xl p-4 flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-[#C84B31] shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#C84B31] font-semibold">
                          Red-Flag Trigger Detected
                        </div>
                        <p className="text-[12px] text-[#991B1B] leading-snug">
                          Confirm readback to log urgent emergency referral immediately.
                        </p>
                      </div>
                    </div>
                  )}

                  {(isLowConfidenceBlocked || slots.requires_clinician_review) && (
                    <div className="bg-[#FFFBEB] border border-[#B45309]/25 rounded-2xl p-4 flex items-start gap-3">
                      <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#B45309] font-semibold">
                          Confidence {Math.round(slots.confidence_score * 100)}% · Escalate for clinician review
                        </div>
                        <p className="text-[12px] text-[#B45309] leading-snug">
                          Verify the highlighted amber field below before saving. Red flags remain active.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] overflow-hidden">
                    <div className="px-4 py-3.5 border-b border-[#E2E0D8] flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#6E6D68]">
                        Step 03 · Structured Intake
                      </span>
                      <span
                        className={`font-mono tabular-nums text-[11px] font-medium ${
                          isLowConfidenceBlocked ? 'text-[#B45309]' : 'text-[#0F3D3E]'
                        }`}
                      >
                        CONF {Math.round(slots.confidence_score * 100)}%
                      </span>
                    </div>

                    <div className="divide-y divide-[#E2E0D8]">
                      <button
                        onClick={() =>
                          setEditingField(
                            editingField === 'primary_symptom' ? null : 'primary_symptom'
                          )
                        }
                        className={`w-full px-4 py-3.5 text-left flex items-center justify-between transition ${
                          lowConfidenceFields.includes('primary_symptom')
                            ? 'bg-[#FFFBEB]'
                            : 'hover:bg-[#F6F5F1]/60'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6E6D68]">
                            Active Symptoms
                          </div>
                          <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#111111]">
                            {getSymptomDisplay(slots.primary_symptom, lang).en}
                          </div>
                          {slots.secondary_symptoms.length > 0 && (
                            <div className="text-[12px] text-[#6E6D68]">
                              +{' '}
                              {slots.secondary_symptoms
                                .map((s) => getSymptomDisplay(s, lang).en)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                        <Edit3 className="w-3.5 h-3.5 text-[#A3A19B] shrink-0" />
                      </button>

                      {slots.resolved_symptoms.length > 0 && (
                        <div className="px-4 py-3 bg-[#F6F5F1]/60 flex items-center justify-between">
                          <div className="space-y-0.5">
                            <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#0F3D3E]">
                              Resolved History (Past)
                            </div>
                            <div className="text-[13px] font-medium text-[#111111]">
                              {slots.resolved_symptoms
                                .map((s) => getSymptomDisplay(s, lang).en)
                                .join(', ')}
                            </div>
                          </div>
                          <span className="font-mono text-[9px] uppercase px-2 py-0.5 rounded bg-[#EAF1F0] text-[#0F3D3E]">
                            RESOLVED
                          </span>
                        </div>
                      )}

                      <div
                        className={`px-4 py-3.5 flex items-center justify-between transition ${
                          lowConfidenceFields.includes('duration_days')
                            ? 'bg-[#FFFBEB]'
                            : 'hover:bg-[#F6F5F1]/60'
                        }`}
                      >
                        <button
                          onClick={() =>
                            setEditingField(
                              editingField === 'duration_days' ? null : 'duration_days'
                            )
                          }
                          className="flex-1 text-left space-y-0.5"
                        >
                          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6E6D68]">
                            Duration
                          </div>
                          <div
                            className={`text-[15px] font-semibold tracking-[-0.02em] font-mono tabular-nums ${
                              lowConfidenceFields.includes('duration_days')
                                ? 'text-[#B45309]'
                                : 'text-[#111111]'
                            }`}
                          >
                            {slots.duration_days ?? 1} day{(slots.duration_days ?? 1) > 1 ? 's' : ''}
                          </div>
                        </button>

                        <div className="flex items-center gap-2">
                          {lowConfidenceFields.includes('duration_days') && (
                            <button
                              onClick={() => {
                                setSlots({
                                  ...slots,
                                  confidence_score: 0.96,
                                  requires_clinician_review: false,
                                });
                                setLowConfidenceFields([]);
                                showToast('Duration verified');
                              }}
                              className="h-7 px-2.5 rounded-lg bg-[#B45309] text-white text-[11px] font-medium"
                            >
                              Verify
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setEditingField(
                                editingField === 'duration_days' ? null : 'duration_days'
                              )
                            }
                            aria-label="Edit duration"
                            className="p-1.5 text-[#A3A19B] hover:text-[#111111]"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() =>
                          setEditingField(
                            editingField === 'spoken_vitals' ? null : 'spoken_vitals'
                          )
                        }
                        className="w-full px-4 py-3.5 text-left flex items-center justify-between hover:bg-[#F6F5F1]/60 transition"
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#6E6D68]">
                            Spoken Vitals &amp; Meds
                          </div>
                          <div className="text-[13px] font-medium text-[#111111]">
                            {[
                              slots.spoken_vitals.bp ? `BP ${slots.spoken_vitals.bp}` : null,
                              slots.spoken_vitals.temperature
                                ? `Temp ${slots.spoken_vitals.temperature}`
                                : null,
                              slots.spoken_vitals.sugar
                                ? `Sugar ${slots.spoken_vitals.sugar}`
                                : null,
                              slots.spoken_vitals.medications.length > 0
                                ? slots.spoken_vitals.medications.join(', ')
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'None mentioned'}
                          </div>
                        </div>
                        <Edit3 className="w-3.5 h-3.5 text-[#A3A19B] shrink-0" />
                      </button>

                      <div className="px-4 py-3 flex items-center justify-between text-[11px] font-mono">
                        <span className="text-[#6E6D68] truncate pr-2">
                          {slots.negated_symptoms.length > 0
                            ? `NEGATED: ${slots.negated_symptoms.join(', ')}`
                            : 'NEGATIONS: NONE'}
                        </span>
                        <span
                          className={`uppercase font-semibold shrink-0 ${
                            isRedFlagActive
                              ? 'text-[#C84B31]'
                              : slots.severity_grade === 'severe'
                              ? 'text-[#B45309]'
                              : 'text-[#0F3D3E]'
                          }`}
                        >
                          {slots.severity_grade.replace('_', ' ')}
                        </span>
                      </div>
                    </div>

                    {editingField && (
                      <div className="px-4 py-3.5 bg-[#F6F5F1] border-t border-[#E2E0D8] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#0F3D3E]">
                            Edit {editingField.replace('_', ' ')}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleMicCapture('edit')}
                              className={`text-[11px] font-medium inline-flex items-center gap-1 ${
                                isRecording && listenMode === 'edit'
                                  ? 'text-[#C84B31]'
                                  : 'text-[#0F3D3E]'
                              }`}
                            >
                              <Mic className="w-3 h-3" />
                              <span>
                                {isRecording && listenMode === 'edit' ? 'Listening' : 'Voice'}
                              </span>
                            </button>
                            <button
                              onClick={() => setEditingField(null)}
                              className="text-[#6E6D68] hover:text-[#111111]"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {editingField === 'duration_days' && (
                          <div className="grid grid-cols-4 gap-1.5">
                            {[1, 2, 3, 7].map((d) => (
                              <button
                                key={d}
                                onClick={() => {
                                  const updated = {
                                    ...slots,
                                    duration_days: d,
                                    confidence_score: 0.96,
                                    requires_clinician_review: false,
                                  };
                                  setSlots(updated);
                                  setLowConfidenceFields((prev) =>
                                    prev.filter((f) => f !== 'duration_days')
                                  );
                                  setEditingField(null);
                                  speakReadback(updated);
                                }}
                                className="h-9 rounded-xl bg-white border border-[#E2E0D8] text-[12px] font-mono font-medium text-[#111111] hover:border-[#0F3D3E]"
                              >
                                {d}d
                              </button>
                            ))}
                          </div>
                        )}

                        {editingField === 'primary_symptom' && (
                          <div className="grid grid-cols-2 gap-1.5">
                            {['fever', 'high_fever', 'abdominal_pain', 'dizziness'].map((sym) => (
                              <button
                                key={sym}
                                onClick={() => {
                                  const updated = {
                                    ...slots,
                                    primary_symptom: sym,
                                    confidence_score: 0.96,
                                    requires_clinician_review: false,
                                  };
                                  setSlots(updated);
                                  setLowConfidenceFields((prev) =>
                                    prev.filter((f) => f !== 'primary_symptom')
                                  );
                                  setEditingField(null);
                                  speakReadback(updated);
                                }}
                                className="h-9 px-2.5 rounded-xl bg-white border border-[#E2E0D8] text-[12px] text-left font-medium text-[#111111] hover:border-[#0F3D3E]"
                              >
                                {getSymptomDisplay(sym, lang).en}
                              </button>
                            ))}
                          </div>
                        )}

                        {editingField === 'spoken_vitals' && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {['120/80 mmHg', '130/85 mmHg', '140/90 mmHg'].map((bp) => (
                              <button
                                key={bp}
                                onClick={() => {
                                  setSlots({
                                    ...slots,
                                    spoken_vitals: { ...slots.spoken_vitals, bp },
                                  });
                                  setEditingField(null);
                                }}
                                className="h-9 rounded-xl bg-white border border-[#E2E0D8] text-[11px] font-mono text-[#111111] hover:border-[#0F3D3E]"
                              >
                                {bp.replace(' mmHg', '')}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => speakReadback(slots)}
                        className="h-8 px-3 rounded-full bg-white border border-[#E2E0D8] text-[11px] font-medium text-[#111111] inline-flex items-center gap-1.5 hover:border-[#111111]/25 transition"
                      >
                        <Volume2 className="w-3 h-3 text-[#0F3D3E]" />
                        <span>Readback</span>
                      </button>
                      <button
                        onClick={() => toggleMicCapture('readback')}
                        className={`h-8 px-3 rounded-full border text-[11px] font-medium inline-flex items-center gap-1.5 transition ${
                          isRecording && listenMode === 'readback'
                            ? 'bg-[#C84B31] text-white border-[#C84B31]'
                            : 'bg-white border-[#E2E0D8] text-[#111111] hover:border-[#111111]/25'
                        }`}
                      >
                        <Mic className="w-3 h-3" />
                        <span>Say “{LANGUAGE_META[lang].confirmWord}”</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setShowRawJson(!showRawJson)}
                      className={`h-8 px-3 rounded-full border font-mono text-[11px] inline-flex items-center gap-1.5 transition ${
                        showRawJson
                          ? 'bg-[#111111] text-white border-[#111111]'
                          : 'bg-white text-[#6E6D68] border-[#E2E0D8] hover:text-[#111111]'
                      }`}
                    >
                      <FileJson className="w-3 h-3" />
                      <span>JSON</span>
                    </button>
                  </div>

                  {showRawJson && (
                    <pre className="bg-[#111111] text-[#EAF1F0] font-mono text-[11px] leading-relaxed p-4 rounded-2xl overflow-x-auto">
                      {JSON.stringify(slots, null, 2)}
                    </pre>
                  )}

                  <button
                    disabled={isLowConfidenceBlocked}
                    onClick={() => void finalizeAndSave(slots, rawTranscript, redFlagsTriggered)}
                    className={`w-full h-14 rounded-2xl text-[14px] font-medium flex items-center justify-center gap-2 transition ${
                      isLowConfidenceBlocked
                        ? 'bg-[#111111]/[0.08] text-[#A3A19B] cursor-not-allowed'
                        : isRedFlagActive
                        ? 'bg-[#C84B31] hover:bg-[#A63B24] text-white'
                        : 'bg-[#0F3D3E] hover:bg-[#0B2F30] text-white'
                    }`}
                  >
                    <Lock className="w-4 h-4" />
                    <span>
                      {isLowConfidenceBlocked
                        ? 'Verify Amber Field to Unlock Save'
                        : isRedFlagActive
                        ? 'Encrypt & Trigger Emergency Referral'
                        : `${LANGUAGE_META[lang].confirmWord} · Encrypt & Queue Offline`}
                    </span>
                  </button>
                </div>
              )}

              {step === 4 && slots && (
                <div className="space-y-5 pt-1">
                  {isRedFlagActive ? (
                    <div className="bg-[#FEF2F2] border border-[#C84B31]/30 rounded-3xl p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#C84B31]">
                          Emergency Referral · Red Flag
                        </span>
                        <PhoneCall className="w-4 h-4 text-[#C84B31]" />
                      </div>
                      <h2 className="text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] text-[#C84B31]">
                        Immediate doctor referral required.
                      </h2>
                      <p className="text-[13px] leading-relaxed text-[#7F1D1D]">
                        Detected:{' '}
                        <span className="font-semibold">
                          {(redFlagsTriggered.length > 0
                            ? redFlagsTriggered
                            : [slots.primary_symptom]
                          )
                            .map((rf) => getSymptomDisplay(rf, lang).en)
                            .join(', ')}
                        </span>
                        . Escalate immediately to nearest PHC/CHC Medical Officer or 108 Ambulance.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white border border-[#E2E0D8] rounded-3xl p-6 space-y-3 shadow-[0_1px_2px_rgba(17,17,17,0.03)]">
                      <div className="w-10 h-10 rounded-full bg-[#EAF1F0] text-[#0F3D3E] flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <h2 className="text-[24px] leading-[1.15] font-semibold tracking-[-0.03em] text-[#111111]">
                        Encrypted &amp; queued.
                      </h2>
                      <p className="text-[13px] text-[#6E6D68]">
                        PII locked with <span className="font-mono text-[#0F3D3E]">AES-256-GCM</span>
                        . Zero-PII FHIR R4 queued as{' '}
                        <span className="font-mono text-[#111111]">
                          {savedRecordId?.slice(0, 8)}…
                        </span>
                      </p>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl border border-[#E2E0D8] divide-y divide-[#E2E0D8] text-[13px]">
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[#6E6D68]">Encounter UUID</span>
                      <span className="font-mono text-[11px] text-[#111111]">
                        {savedRecordId?.slice(0, 13)}…
                      </span>
                    </div>
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[#6E6D68]">Active Complaint</span>
                      <span className="font-medium text-[#111111]">
                        {getSymptomDisplay(slots.primary_symptom, lang).en} (
                        {slots.duration_days ?? 1}d)
                      </span>
                    </div>
                    <div className="px-4 py-3 flex justify-between">
                      <span className="text-[#6E6D68]">Storage Split</span>
                      <span className="font-mono text-[11px] text-[#0F3D3E] inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" /> PII DEK + Coarse FHIR
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <button
                      onClick={() => setView('queue')}
                      className="h-12 rounded-2xl bg-white border border-[#E2E0D8] text-[#111111] text-[13px] font-medium hover:border-[#111111]/25 transition"
                    >
                      Open Queue
                    </button>
                    <button
                      onClick={() => startLanguageIntake(lang)}
                      className="h-12 rounded-2xl bg-[#0F3D3E] text-white text-[13px] font-medium hover:bg-[#0B2F30] transition"
                    >
                      Next Patient
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'queue' && (
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#0F3D3E]">
                    <Lock className="w-3 h-3" />
                    <span>Split PII/FHIR · {records.length} Records</span>
                  </div>
                  <h2 className="text-[24px] font-semibold tracking-[-0.03em] text-[#111111] mt-0.5">
                    Offline Queue
                  </h2>
                </div>

                <button
                  onClick={() => void handleSyncNow(false)}
                  disabled={isSyncing || pendingCount === 0}
                  className={`h-9 px-3.5 rounded-full text-[12px] font-medium inline-flex items-center gap-1.5 transition ${
                    pendingCount === 0
                      ? 'bg-[#111111]/[0.06] text-[#A3A19B] cursor-not-allowed'
                      : 'bg-[#0F3D3E] hover:bg-[#0B2F30] text-white'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Sending…' : `Sync (${pendingCount})`}</span>
                </button>
              </div>

              {!vaultInitialized && (
                <button
                  onClick={() => setShowPassphraseSetup(true)}
                  className="w-full bg-[#EAF1F0]/75 hover:bg-[#EAF1F0] rounded-2xl border border-[#0F3D3E]/20 px-4 py-2.5 flex items-center justify-between text-left transition"
                >
                  <span className="font-mono text-[10px] font-medium text-[#0F3D3E] inline-flex items-center gap-1.5">
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>Session Encryption Active · Set Passphrase to Lock</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#0F3D3E] shrink-0" />
                </button>
              )}

              {backendUnreachable && (
                <div className="bg-[#FFFBEB] border border-[#B45309]/25 rounded-2xl px-4 py-2.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[#B45309]">
                    Demo Mode — Local Queue Only
                  </span>
                  <span className="font-mono text-[10px] text-[#B45309]">Backend Unreachable</span>
                </div>
              )}

              <button
                onClick={() => {
                  void exportEncryptedBackupBundle(records).then((filename) =>
                    showToast(`Exported encrypted backup · ${filename}`)
                  );
                }}
                className="w-full h-10 rounded-2xl bg-white hover:bg-[#EAF1F0]/50 border border-[#E2E0D8] text-[#0F3D3E] text-[12px] font-medium inline-flex items-center justify-center gap-2 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Encrypted Backup (.bse.json)</span>
              </button>

              <div className="bg-white rounded-2xl border border-[#E2E0D8] px-4 py-3 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-[12px] font-medium text-[#111111]">
                    Simulate Flaky 3G Backoff
                  </div>
                  <div className="font-mono text-[10px] text-[#6E6D68]">
                    Tests 1s → 2s → 4s retries + DEMO_SIMULATED state
                  </div>
                </div>
                <button
                  onClick={() => setSimulateFlaky3G((prev) => !prev)}
                  aria-label="Toggle Simulate Flaky 3G Backoff"
                  className={`w-11 h-6 rounded-full p-0.5 transition ${
                    simulateFlaky3G ? 'bg-[#B45309]' : 'bg-[#111111]/[0.14]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      simulateFlaky3G ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {syncTelemetry && (
                <div className="bg-[#FFFBEB] border border-[#B45309]/25 rounded-2xl px-4 py-2.5 font-mono text-[11px] text-[#B45309] flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">{syncTelemetry}</span>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-[#E2E0D8] shadow-[0_1px_2px_rgba(17,17,17,0.03)] divide-y divide-[#E2E0D8]">
                {records.map((rec) => {
                  const { stored, pii } = rec;
                  const critical =
                    stored.slots.severity_grade === 'critical_red_flag' ||
                    stored.red_flags_triggered.length > 0;
                  return (
                    <div key={stored.encounter_id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-[#6E6D68]">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                critical
                                  ? 'bg-[#C84B31]'
                                  : stored.slots.severity_grade === 'severe'
                                  ? 'bg-[#B45309]'
                                  : 'bg-[#0F3D3E]'
                              }`}
                            />
                            <span className="tabular-nums">
                              {stored.encounter_id.slice(0, 8)}…
                            </span>
                            <span>·</span>
                            <span>{LANGUAGE_META[stored.language].codeLabel}</span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5 text-[#0F3D3E]">
                              <Lock className="w-2.5 h-2.5" /> DEK
                            </span>
                            {stored.retry_count > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-[#B45309]">retries:{stored.retry_count}</span>
                              </>
                            )}
                          </div>

                          <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#111111] truncate">
                            {getSymptomDisplay(stored.slots.primary_symptom, stored.language).en}{' '}
                            <span className="font-mono text-[12px] font-normal text-[#6E6D68]">
                              · {stored.slots.duration_days ?? 1}d
                            </span>
                          </div>

                          <p className="text-[11px] text-[#6E6D68] truncate">
                            {pii.patient.name} ({pii.patient.age}y/{pii.patient.sex})
                            {stored.slots.resolved_symptoms.length > 0
                              ? ` · Resolved: ${stored.slots.resolved_symptoms.join(', ')}`
                              : ''}
                          </p>
                          {stored.last_error && (
                            <p className="font-mono text-[10px] text-[#B45309] truncate">
                              {stored.last_error}
                            </p>
                          )}
                        </div>

                        <span
                          className={`font-mono text-[9px] uppercase tracking-[0.04em] px-2 py-0.5 rounded-full shrink-0 ${
                            stored.sync_status === 'ACKED'
                              ? 'bg-[#EAF1F0] text-[#0F3D3E]'
                              : stored.sync_status === 'FAILED_4XX'
                              ? 'bg-[#FEF2F2] text-[#C84B31] border border-[#C84B31]/25'
                              : stored.sync_status === 'DRAFT'
                              ? 'bg-[#F6F5F1] text-[#6E6D68] border border-[#E2E0D8]'
                              : 'bg-[#FFFBEB] text-[#B45309]'
                          }`}
                          title={stored.last_error}
                        >
                          {stored.sync_status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-0.5">
                        {stored.sync_status === 'DRAFT' ? (
                          <button
                            onClick={() => resumeDraftEncounter(rec)}
                            className="flex-1 h-9 rounded-xl bg-[#0F3D3E] hover:bg-[#0B2F30] text-white text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            <span>Resume Draft</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setHandoffRecord(rec);
                              setHandoffTab('slip');
                            }}
                            className="flex-1 h-9 rounded-xl bg-[#F6F5F1] hover:bg-[#EAF1F0] text-[#111111] hover:text-[#0F3D3E] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Doctor Slip &amp; FHIR</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setHandoffRecord(rec);
                            setHandoffTab('cipher');
                          }}
                          className="h-9 px-3 rounded-xl bg-white border border-[#E2E0D8] hover:border-[#0F3D3E] text-[#111111] font-mono text-[11px] inline-flex items-center gap-1.5 transition"
                        >
                          <Lock className="w-3 h-3 text-[#0F3D3E]" />
                          <span>Cipher</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {/* ================================================================ */}
        {/* STANDALONE FLOATING DARK BOTTOM PILL NAVIGATION                  */}
        {/* ================================================================ */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-32px)] max-w-[340px]">
          <nav className="bg-[#111111]/95 backdrop-blur-md text-[#F6F5F1] rounded-full p-1.5 shadow-[0_12px_32px_rgba(17,17,17,0.22)] border border-white/10 grid grid-cols-3 gap-1">
            <button
              onClick={() => {
                setSimSheetOpen(false);
                setView(view === 'intake' ? 'home' : 'intake');
              }}
              className={`h-10 rounded-full text-[12px] font-medium flex items-center justify-center gap-1.5 transition ${
                view === 'home' || view === 'intake'
                  ? 'bg-white text-[#111111]'
                  : 'text-[#A3A19B] hover:text-white'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Intake</span>
            </button>

            <button
              onClick={() => {
                setSimSheetOpen(false);
                setView('queue');
              }}
              className={`h-10 rounded-full text-[12px] font-medium flex items-center justify-center gap-1.5 transition ${
                view === 'queue'
                  ? 'bg-white text-[#111111]'
                  : 'text-[#A3A19B] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Queue</span>
              {pendingCount > 0 && (
                <span
                  className={`font-mono tabular-nums text-[10px] px-1.5 rounded-full ${
                    view === 'queue'
                      ? 'bg-[#0F3D3E] text-white'
                      : 'bg-white/15 text-[#F6F5F1]'
                  }`}
                >
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setSimSheetOpen((prev) => !prev)}
              className={`h-10 rounded-full text-[12px] font-medium flex items-center justify-center gap-1.5 transition ${
                simSheetOpen
                  ? 'bg-[#C84B31] text-white'
                  : 'text-[#A3A19B] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Simulate</span>
            </button>
          </nav>
        </div>

        {simSheetOpen && (
          <SimulatorSheet
            onClose={() => setSimSheetOpen(false)}
            onRunScenario={runScenario}
          />
        )}

        {handoffRecord && (
          <DoctorHandoffModal
            record={handoffRecord}
            activeTab={handoffTab}
            onTabChange={setHandoffTab}
            onClose={() => setHandoffRecord(null)}
            onCopySlip={handleCopyEsanjeevani}
            onNotify={(msg) => showToast(msg)}
          />
        )}

        {patientModalOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-5">
            <div
              onClick={() => setPatientModalOpen(false)}
              className="absolute inset-0 bg-[#111111]/45 backdrop-blur-[2px]"
            />
            <div className="relative z-10 w-full bg-white rounded-3xl border border-[#E2E0D8] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-[#111111]">
                  Patient Identity (Encrypted PII)
                </h3>
                <button
                  onClick={() => setPatientModalOpen(false)}
                  aria-label="Close Patient Identity Modal"
                  className="w-8 h-8 rounded-full bg-[#F6F5F1] flex items-center justify-center text-[#6E6D68]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-[13px]">
                <div>
                  <input
                    type="text"
                    value={patient.name}
                    onChange={(e) => {
                      setPatient({ ...patient, name: e.target.value });
                      if (patientErrors.name) setPatientErrors({ ...patientErrors, name: undefined });
                    }}
                    placeholder="Patient Name (e.g. Sunita Devi)"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8] focus:outline-none focus:border-[#0F3D3E]"
                  />
                  {patientErrors.name && (
                    <p className="text-[11px] text-[#C84B31] mt-1">{patientErrors.name}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="number"
                      value={patient.age}
                      onChange={(e) => {
                        setPatient({ ...patient, age: e.target.value });
                        if (patientErrors.age) setPatientErrors({ ...patientErrors, age: undefined });
                      }}
                      placeholder="Age (yrs)"
                      className="w-full h-11 px-3.5 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8] focus:outline-none focus:border-[#0F3D3E]"
                    />
                    {patientErrors.age && (
                      <p className="text-[11px] text-[#C84B31] mt-1">{patientErrors.age}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#F6F5F1] p-1 rounded-xl border border-[#E2E0D8] h-11">
                    {(['F', 'M', 'O'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setPatient({ ...patient, sex: s })}
                        className={`rounded-lg font-mono text-[12px] font-medium transition ${
                          patient.sex === s ? 'bg-[#0F3D3E] text-white' : 'text-[#6E6D68]'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={patient.abha_id}
                    onChange={(e) => {
                      setPatient({ ...patient, abha_id: e.target.value });
                      if (patientErrors.abha_id) {
                        setPatientErrors({ ...patientErrors, abha_id: undefined });
                      }
                    }}
                    placeholder="Optional ABHA ID (XX-XXXX-XXXX-XXXX)"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#F6F5F1] border border-[#E2E0D8] font-mono text-[12px] focus:outline-none focus:border-[#0F3D3E]"
                  />
                  {patientErrors.abha_id && (
                    <p className="text-[11px] text-[#C84B31] mt-1">{patientErrors.abha_id}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  const res = validatePatientProfile(patient);
                  if (!res.valid) {
                    setPatientErrors(res.errors);
                    return;
                  }
                  setPatient(res.sanitized);
                  setPatientErrors({});
                  setPatientModalOpen(false);
                }}
                className="w-full h-11 rounded-2xl bg-[#0F3D3E] text-white text-[13px] font-medium"
              >
                Save Patient Details
              </button>
            </div>
          </div>
        )}

        {icmrModalOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-5">
            <div
              onClick={() => setIcmrModalOpen(false)}
              className="absolute inset-0 bg-[#111111]/45 backdrop-blur-[2px]"
            />
            <div className="relative z-10 w-full bg-white rounded-3xl border border-[#E2E0D8] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#0F3D3E]" />
                  <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-[#111111]">
                    Designed with reference to ICMR 2023 &amp; DPDP
                  </h3>
                </div>
                <button
                  onClick={() => setIcmrModalOpen(false)}
                  aria-label="Close ICMR Modal"
                  className="w-8 h-8 rounded-full bg-[#F6F5F1] flex items-center justify-center text-[#6E6D68]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ul className="space-y-2.5 text-[12px] leading-relaxed text-[#6E6D68]">
                <li>
                  <strong className="text-[#111111]">1. Human-in-the-Loop Only:</strong> Structures
                  mother-tongue symptoms for eSanjeevani / PHC doctors. Never issues diagnoses or
                  drug prescriptions.
                </li>
                <li>
                  <strong className="text-[#111111]">2. Envelope Encryption Vault:</strong>{' '}
                  PBKDF2 (600k SHA-256) wraps a random 256-bit DEK held non-extractable in RAM
                  and auto-locks after 5 minutes idle or tab switch.
                </li>
                <li>
                  <strong className="text-[#111111]">3. Split PII / Coarse FHIR Storage:</strong>{' '}
                  Patient PII stays encrypted locally while coarse-dated (YYYY-MM-DD) zero-PII FHIR
                  R4 bundles queue for Background Sync.
                </li>
                <li>
                  <strong className="text-[#111111]">4. Explicit Verbal Consent:</strong> Clinical
                  mic stays locked until verbal confirmation, with a zero-audio tap fallback.
                </li>
              </ul>
              <button
                onClick={() => setIcmrModalOpen(false)}
                className="w-full h-11 rounded-2xl bg-[#111111] text-white text-[13px] font-medium"
              >
                Understood
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
