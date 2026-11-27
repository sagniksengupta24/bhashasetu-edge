import os
import tempfile
import uuid

import pytest
from fastapi.testclient import TestClient

_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()
os.environ["BHASHASETU_DB_PATH"] = _tmp_db.name

import main  # noqa: E402


@pytest.fixture(autouse=True)
def reset_state():
    main.init_db()
    conn = main.get_conn()
    try:
        conn.execute("DELETE FROM fhir_encounters;")
        conn.commit()
    finally:
        conn.close()
    main.reset_rate_limits()


def sample_bundle(encounter_id: str) -> dict:
    return {
        "resourceType": "Bundle",
        "id": f"abdm-fhir-{encounter_id}",
        "type": "collection",
        "identifier": {
            "system": "https://abdm.gov.in/bhashasetu/idempotency",
            "value": encounter_id,
        },
        "entry": [
            {
                "fullUrl": f"urn:uuid:{encounter_id}-enc",
                "resource": {
                    "resourceType": "Encounter",
                    "id": encounter_id,
                    "status": "finished",
                },
            }
        ],
    }


def test_health_check():
    with TestClient(main.app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert "sqlite" in body["db"]


def test_fhir_intake_and_idempotency_deduplication():
    enc_id = str(uuid.uuid4())
    device_id = str(uuid.uuid4())
    with TestClient(main.app) as client:
        res1 = client.post(
            "/api/abdm/fhir-intake",
            json=sample_bundle(enc_id),
            headers={"Idempotency-Key": enc_id, "X-Device-Id": device_id},
        )
        assert res1.status_code == 201
        assert res1.json()["status"] == "acked"
        assert res1.json()["encounter_id"] == enc_id

        # Duplicate Idempotency-Key returns 200 without double-inserting
        res2 = client.post(
            "/api/abdm/fhir-intake",
            json=sample_bundle(enc_id),
            headers={"Idempotency-Key": enc_id, "X-Device-Id": device_id},
        )
        assert res2.status_code == 200
        assert res2.json()["status"] == "duplicate_ignored"

        listed = client.get("/api/abdm/encounters", headers={"X-Device-Id": device_id})
        assert listed.status_code == 200
        assert listed.json()["count"] == 1


def test_rejects_malformed_payload_and_bad_idempotency_key():
    enc_id = str(uuid.uuid4())
    with TestClient(main.app) as client:
        # Missing Idempotency-Key
        r_missing = client.post("/api/abdm/fhir-intake", json=sample_bundle(enc_id))
        assert r_missing.status_code == 400

        # Invalid UUID Idempotency-Key
        r_bad_uuid = client.post(
            "/api/abdm/fhir-intake",
            json=sample_bundle(enc_id),
            headers={"Idempotency-Key": "not-a-uuid"},
        )
        assert r_bad_uuid.status_code == 400

        # Wrong resourceType -> 422
        r_bad_bundle = client.post(
            "/api/abdm/fhir-intake",
            json={"resourceType": "Patient", "entry": [{"resource": {"id": "1"}}]},
            headers={"Idempotency-Key": enc_id},
        )
        assert r_bad_bundle.status_code == 422

        # Empty entry -> 422
        r_empty_entry = client.post(
            "/api/abdm/fhir-intake",
            json={"resourceType": "Bundle", "entry": []},
            headers={"Idempotency-Key": enc_id},
        )
        assert r_empty_entry.status_code == 422


def test_rate_limit_enforced_at_60_per_minute():
    with TestClient(main.app) as client:
        for i in range(60):
            uid = str(uuid.uuid4())
            res = client.post(
                "/api/abdm/fhir-intake",
                json=sample_bundle(uid),
                headers={"Idempotency-Key": uid},
            )
            assert res.status_code == 201, f"Failed on request {i}"

        uid_61 = str(uuid.uuid4())
        res_61 = client.post(
            "/api/abdm/fhir-intake",
            json=sample_bundle(uid_61),
            headers={"Idempotency-Key": uid_61},
        )
        assert res_61.status_code == 429
