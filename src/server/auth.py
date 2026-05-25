import hashlib, hmac as _hmac, base64, json, time, secrets, os
from typing import Optional

_HERE        = os.path.dirname(os.path.abspath(__file__))
_SECRET_FILE = os.path.join(_HERE, ".secret")
_USERS_FILE  = os.path.join(_HERE, "users_db.json")

# ── Secret key (auto-generated once, persisted) ─────────────
def _load_secret() -> str:
    if os.path.exists(_SECRET_FILE):
        with open(_SECRET_FILE) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(_SECRET_FILE, "w") as f:
        f.write(key)
    return key

_SECRET = _load_secret()

# ── Password (PBKDF2-HMAC-SHA256, 260k iterations) ──────────
def hash_password(pwd: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), 260_000)
    return f"{salt}:{h.hex()}"

def verify_password(plain: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        h2 = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260_000)
        return _hmac.compare_digest(h2.hex(), h)
    except Exception:
        return False

# ── HMAC token ───────────────────────────────────────────────
def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64d(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)

def create_token(username: str, role: str, expires_in: int = 28800) -> str:
    payload = json.dumps({
        "sub": username, "role": role,
        "exp": int(time.time()) + expires_in,
    }).encode()
    sig = _hmac.new(_SECRET.encode(), payload, hashlib.sha256).digest()
    return f"{_b64e(payload)}.{_b64e(sig)}"

def decode_token(token: str) -> Optional[dict]:
    try:
        pb64, sb64 = token.split(".", 1)
        payload_bytes = _b64d(pb64)
        expected = _hmac.new(_SECRET.encode(), payload_bytes, hashlib.sha256).digest()
        if not _hmac.compare_digest(_b64d(sb64), expected):
            return None
        data = json.loads(payload_bytes)
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None

# ── Users DB ─────────────────────────────────────────────────
def load_users() -> dict:
    if not os.path.exists(_USERS_FILE):
        return {}
    with open(_USERS_FILE) as f:
        return json.load(f)

def save_users(users: dict):
    with open(_USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)

ROLES = ["admin", "user", "tester"]
