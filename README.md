# BhashaSetu Edge

**Offline-first, trilingual (Hindi / Hinglish / Bengali) clinical voice intake & ABDM FHIR R4 pre-triage PWA + FastAPI/SQLite sync backend.**

Designed with reference to **ICMR 2023 HITL** & **DPDP** principles: structures patient-reported symptoms for clinician review without issuing autonomous diagnoses or prescriptions, keeps patient PII encrypted on-device, and separates coarse-dated zero-PII FHIR R4 bundles for offline queuing and idempotent server sync.

---

## One-Command Start (Zero API Keys Required)

```bash
docker compose up --build
```

Open **`http://localhost:8080`** in Chrome/Edge/Brave.

- **`bhashasetu-edge`** (`nginxinc/nginx-unprivileged:1.27-alpine` on port `8080`) serves the hardened PWA with strict CSP/security headers and reverse-proxies `/api/` to `api:8000`.
- **`api`** (`backend/main.py`, FastAPI + SQLite WAL on named volume `bhashasetu_data`) persists anonymized FHIR R4 bundles with `Idempotency-Key` deduplication and per-IP rate limiting (60 req/min).
- **Why `localhost`?** `http://localhost:8080` is a browser **secure context**, enabling microphone capture (`getUserMedia`), WebCrypto (`crypto.subtle`), IndexedDB, and Service Worker registration with zero `.env` files or external API keys.

---

## 2-Minute Judge Walkthrough

1. **Immediate Encrypted Boot & Trilingual Intake:**
   - The app boots straight into **Select patient language** (`हिन्दी`, `Hinglish`, `বাংলা`) using an ephemeral RAM-only 256-bit `AES-GCM` session key.
   - Tap a language, confirm verbal consent (Step 1), and speak or type a symptom phrase — or tap **Simulate** in the bottom pill to run any of the **7 deterministic edge-case scenarios**.
2. **Clause-Level Negation & 6 Clinical Red Flags:**
   - Try Scenario 1 (`"Bukhar nahi hai par seene mein tez dard hai do din se"`) or Scenario 2 (`"Bukhar toh kal utar gaya, ab bas chhati bhari lag rahi hai"`).
   - Negated or resolved symptoms (`fever`) are separated from active red-flag triggers (`chest_pain`, `chest_heaviness`). Low ASR confidence (`< 0.85`) never suppresses a red flag and flags `requires_clinician_review: true`.
3. **Offline ONNX Worker, Storage Quota & Airplane Mode Reload:**
   - Tap the **CPU** icon in the header to open the **Engine Drawer**, inspect Storage Persistence & Quota, and click **Load ~40MB ONNX** once to cache `Xenova/whisper-tiny` (`q8`).
   - Toggle **DevTools → Network → Offline** and hard-reload: Workbox `sw.js` precaches all hashed JS/CSS/worker/WASM chunks so the app boots and queues encounters as `QUEUED`.
4. **Honest Sync State Machine & Encrypted Backup:**
   - When online, **Queue → Sync** posts anonymized FHIR R4 bundles to `POST /api/abdm/fhir-intake`, transitioning records to `ACKED` only on HTTP `200–299` (`FAILED_4XX` on schema errors, `FAILED_RETRYABLE` with `1s→2s→4s` backoff on 5xx/network errors).
   - Tap **Export Encrypted Backup (.bse.json)** to download encrypted IndexedDB records + wrapped vault metadata (zero plaintext).
5. **Optional 6+ Character Passphrase Vault Lock:**
   - Tap **Session Encryption Active · Set Passphrase to Lock** (or the header **Lock** icon) to wrap the 256-bit DEK with **PBKDF2 (600,000 iterations, SHA-256)**, enabling 5-minute idle/`visibilitychange` auto-lock, encrypted `DRAFT` autosave, and `Wipe & Reset Vault`.

---

## Architecture

- **Frontend (`src/`):**
  - Dual-Engine ASR (`Whisper-Tiny q8` ONNX WASM Worker with `numThreads = 1` & 30s watchdog + Browser `SpeechRecognition` + 60s recording cap + 2-strike visual fallback).
  - 3-Tier Neural Voice (`src/tts/voiceEngine.ts`): 27 pre-rendered studio MP3 clips (`public/audio/`) + lazy-loaded **Ninada 24 kHz** ONNX WASM streaming (`gnumanth/ninada`) + automatic `speechSynthesis` & visual caption fallback.
  - Native-script Devanagari/Bengali normalizer (`src/slu/normalize.ts`), word-boundary SLU (`src/slu/parser.ts`), and pure input validators (`src/slu/validation.ts`).
  - Envelope encryption (`src/crypto/vault.ts`), StorageManager persistence/quota guard (`src/db/storageGuard.ts`), Web Locks + `BroadcastChannel` multi-tab sync (`src/sync/queue.ts`).
- **Backend (`backend/`):**
  - `GET /api/health` (`sqlite-wal`), `POST /api/abdm/fhir-intake` (`Idempotency-Key` UUID deduplication, `X-Device-Id` scoping, 60 req/min rate limiter), `GET /api/abdm/encounters`.

---

## Local Dev & Tests

```bash
npm ci
npm test          # Vitest unit suites (SLU normalizer/parser, validation, VaultCrypto)
npm run build     # Typecheck + production Vite + Workbox sw.js bundle
npm run test:e2e  # Playwright Chromium E2E suite
```
