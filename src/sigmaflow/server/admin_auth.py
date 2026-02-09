"""
Authentication and authorization utilities for admin system.
"""

import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import jwt
import bcrypt
from fastapi import Depends, HTTPException, Header


# Configuration
JWT_SECRET = os.getenv("JWT_SECRET", "default_jwt_secret_change_in_production")
JWT_EXPIRY = os.getenv("JWT_EXPIRY", "1d")
BCRYPT_SALT_ROUNDS = 10
API_KEY_PREFIX = "ak_"


class JwtPayload:
    """JWT token payload"""
    def __init__(self, user_id: str, role: str):
        self.id = user_id
        self.role = role


def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_SALT_ROUNDS)).decode()


def compare_password(password: str, hash_value: str) -> bool:
    """Compare password with hash"""
    return bcrypt.checkpw(password.encode(), hash_value.encode())


def generate_jwt(payload: Dict[str, Any], expires_in: Optional[str] = None) -> str:
    """Generate JWT token"""
    expiry = expires_in or JWT_EXPIRY
    expire_delta = parse_expiry(expiry)
    expire = datetime.now(timezone.utc) + expire_delta
    payload_with_exp = {**payload, "exp": expire}
    return jwt.encode(payload_with_exp, JWT_SECRET, algorithm="HS256")


def parse_expiry(expires_in: str) -> timedelta:
    """Parse expiry string to timedelta"""
    match expires_in:
        case "1d":
            return timedelta(days=1)
        case "1_month":
            return timedelta(days=30)
        case "3_months":
            return timedelta(days=90)
        case "6_months":
            return timedelta(days=180)
        case "12_months":
            return timedelta(days=365)
        case "never":
            return timedelta(days=36500)  # 100 years
        case _:
            return timedelta(days=1)


def verify_jwt(token: str) -> JwtPayload:
    """Verify and decode JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return JwtPayload(payload.get("id"), payload.get("role"))
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def generate_api_key() -> tuple[str, str, str]:
    """
    Generate API key with format: ak_<random>
    Returns: (key, prefix, suffix)
    """
    random_bytes = secrets.token_bytes(24)
    random_string = secrets.token_urlsafe(24)[:24]
    key = f"{API_KEY_PREFIX}{random_string}"
    prefix = key[:5]
    suffix = key[-2:]
    return key, prefix, suffix


def hash_api_key(api_key: str) -> str:
    """Hash API key"""
    return hashlib.sha256(api_key.encode()).hexdigest()


def compare_api_key(api_key: str, hash_value: str) -> bool:
    """Compare API key with hash"""
    return hash_api_key(api_key) == hash_value


# Dependency injection functions

async def authenticate_jwt(
    authorization: Optional[str] = Header(None)
) -> JwtPayload:
    """Extract and verify JWT from Authorization header"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No token provided")
    
    token = authorization[7:]  # Remove "Bearer " prefix
    return verify_jwt(token)


async def authenticate_api_key(
    authorization: Optional[str] = Header(None),
    storage = None
) -> Dict[str, str]:
    """Extract and verify API key from Authorization header"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No API key provided")
    
    api_key = authorization[7:]  # Remove "Bearer " prefix
    
    if not api_key.startswith(API_KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Invalid API key format")
    
    # Check against stored keys (requires storage implementation)
    # This will be injected from the AdminAPI class
    if storage:
        valid_key = storage.find_api_key_by_key(api_key)
        if not valid_key:
            raise HTTPException(status_code=401, detail="Invalid API key")
        
        # Check expiration
        if valid_key.expires_at:
            expires_at = datetime.fromisoformat(valid_key.expires_at)
            if expires_at < datetime.utcnow():
                raise HTTPException(status_code=401, detail="API key has expired")
        
        return {"id": valid_key.id, "name": valid_key.name}
    
    raise HTTPException(status_code=401, detail="Invalid API key")
