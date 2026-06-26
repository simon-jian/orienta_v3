import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from .license_public_key import ORIENTA_LICENSE_PUBLIC_KEY_B64


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _public_key() -> Ed25519PublicKey | None:
    key_b64 = ORIENTA_LICENSE_PUBLIC_KEY_B64.strip()
    if not key_b64:
        return None
    key = load_pem_public_key(base64.b64decode(key_b64))
    if not isinstance(key, Ed25519PublicKey):
        raise RuntimeError("[license] orienta-pdr: license public key must be Ed25519")
    return key


def _parse_expiry(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    expires = datetime.fromisoformat(normalized)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires


def enforce_runtime_license(service_name: str) -> None:
    if os.environ.get("ORIENTA_REQUIRE_LICENSE") != "1":
        print(f"[license] {service_name}: license check disabled (ORIENTA_REQUIRE_LICENSE is not 1)")
        return

    key = _public_key()
    if key is None:
        raise RuntimeError(f"[license] {service_name}: missing built-in license public key")

    license_file = Path(os.environ.get("ORIENTA_LICENSE_FILE", "/run/orienta-license/orienta-license.json"))
    try:
        envelope = json.loads(license_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"[license] {service_name}: cannot read license file {license_file}: {exc}") from exc

    payload = envelope.get("payload")
    signature_b64 = envelope.get("signature")
    if not isinstance(payload, dict) or not isinstance(signature_b64, str):
        raise RuntimeError(f"[license] {service_name}: invalid license envelope")

    try:
        key.verify(base64.b64decode(signature_b64), _canonical_json(payload))
    except Exception as exc:
        raise RuntimeError(f"[license] {service_name}: license signature verification failed") from exc

    expires_at = payload.get("expiresAt")
    if isinstance(expires_at, str) and datetime.now(timezone.utc) > _parse_expiry(expires_at):
        raise RuntimeError(f"[license] {service_name}: license expired at {expires_at}")

    customer = payload.get("customer") or "unknown customer"
    license_id = payload.get("licenseId") or "unknown license"
    print(f"[license] {service_name}: licensed to {customer} ({license_id})")
