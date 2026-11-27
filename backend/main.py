import json
import os
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

DB_PATH = os.environ.get("BHASHASETU_DB_PATH", "/data/bhashasetu.db")
RATE_LIMIT_MAX = int(os.environ.get("BHASHASETU_RATE_LIMIT_PER_MIN", "60"))
RATE_LIMIT_WINDOW_S = 60.0

# In-memory per-IP sliding-window rate limiter
_ip_windows: dict[str, deque[float]] = defaultdict(deque)


def get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_db() -> None:
    conn = get_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fhir_encounters (
                idempotency_key TEXT PRIMARY KEY,
                encounter_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                received_at TEXT NOT NULL,
                bundle_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_encounters_device_time ON fhir_encounters(device_id, received_at DESC)"
        )
        conn.commit()
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="BhashaSetu Edge Sync API", version="1.0.0", lifespan=lifespan)


def reset_rate_limits() -> None:
    _ip_windows.clear()


def check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    q = _ip_windows[client_ip]
    while q and now - q[0] >= RATE_LIMIT_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded (60 req/min)")
    q.append(now)


class FhirIdentifier(BaseModel):
    system: str | None = None
    value: str = Field(..., min_length=1, max_length=128)


class FhirBundle(BaseModel):
    resourceType: str
    id: str | None = None
    type: str | None = None
    identifier: FhirIdentifier | None = None
    entry: list[dict[str, Any]] = Field(..., min_length=1)

    @field_validator("resourceType")
    @classmethod
    def must_be_bundle(cls, v: str) -> str:
        if v != "Bundle":
            raise ValueError("resourceType must be 'Bundle'")
        return v

    def extract_encounter_id(self) -> str:
        if self.identifier and self.identifier.value:
            return self.identifier.value
        for item in self.entry:
            res = item.get("resource")
            if isinstance(res, dict) and res.get("resourceType") == "Encounter":
                enc_id = res.get("id")
                if isinstance(enc_id, str) and enc_id.strip():
                    return enc_id.strip()
        raise ValueError("Missing valid encounter_id in Bundle.identifier or Encounter resource")


@app.get("/api/health")
def health():
    conn = get_conn()
    try:
        mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
    finally:
        conn.close()
    return {"status": "ok", "db": f"sqlite-{str(mode).lower()}"}


@app.post("/api/abdm/fhir-intake")
def fhir_intake(
    request: Request,
    payload: FhirBundle,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
):
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip)

    if not idempotency_key:
        raise HTTPException(status_code=400, detail="Missing Idempotency-Key header")
    try:
        normalized_key = str(uuid.UUID(idempotency_key.strip()))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Idempotency-Key must be a valid UUID") from exc

    try:
        encounter_id = payload.extract_encounter_id()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    device_id = (x_device_id or "anonymous-device").strip()[:128] or "anonymous-device"
    received_at = datetime.now(timezone.utc).isoformat()
    bundle_str = json.dumps(payload.model_dump())

    conn = get_conn()
    try:
        existing = conn.execute(
            "SELECT encounter_id, received_at FROM fhir_encounters WHERE idempotency_key = ?",
            (normalized_key,),
        ).fetchone()
        if existing:
            return JSONResponse(
                status_code=200,
                content={
                    "status": "duplicate_ignored",
                    "encounter_id": existing["encounter_id"],
                    "received_at": existing["received_at"],
                },
            )

        conn.execute(
            """
            INSERT INTO fhir_encounters (idempotency_key, encounter_id, device_id, received_at, bundle_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (normalized_key, encounter_id, device_id, received_at, bundle_str),
        )
        conn.commit()
    finally:
        conn.close()

    response.status_code = 201
    return {
        "status": "acked",
        "encounter_id": encounter_id,
        "received_at": received_at,
    }


@app.get("/api/abdm/encounters")
def list_encounters(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    limit: int = 25,
):
    safe_limit = max(1, min(limit, 100))
    device_id = (x_device_id or "anonymous-device").strip()[:128] or "anonymous-device"
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT idempotency_key, encounter_id, device_id, received_at
            FROM fhir_encounters
            WHERE device_id = ?
            ORDER BY received_at DESC
            LIMIT ?
            """,
            (device_id, safe_limit),
        ).fetchall()
    finally:
        conn.close()
    return {
        "device_id": device_id,
        "count": len(rows),
        "encounters": [dict(r) for r in rows],
    }
