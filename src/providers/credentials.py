"""Credential discovery for Claude and Codex APIs."""

import json
import subprocess
import time
from pathlib import Path
from typing import Optional, Dict
from dataclasses import dataclass


@dataclass
class ClaudeCredentials:
    """Claude OAuth credentials."""
    access_token: str
    refresh_token: str
    expires_at: int  # Unix timestamp in milliseconds
    subscription_type: str
    rate_limit_tier: str

    def is_expired(self) -> bool:
        """Check if the access token is expired."""
        # expires_at is in milliseconds, convert to seconds for comparison
        return (self.expires_at / 1000) < time.time()


@dataclass
class CodexCredentials:
    """Codex/OpenAI credentials."""
    access_token: str
    refresh_token: str
    account_id: str
    last_refresh: str


class ClaudeCredentialStore:
    """Manages Claude credential discovery from Keychain and file."""

    KEYCHAIN_SERVICE = "Claude Code-credentials"
    CREDENTIALS_FILE = Path.home() / ".claude" / ".credentials.json"

    def __init__(self):
        self._credentials: Optional[ClaudeCredentials] = None

    def get_credentials(self) -> Optional[ClaudeCredentials]:
        """Get Claude credentials from Keychain or file."""
        if self._credentials is not None:
            return self._credentials

        # Try Keychain first (macOS)
        creds = self._get_from_keychain()
        if creds is not None:
            self._credentials = creds
            return creds

        # Fallback to file
        creds = self._get_from_file()
        if creds is not None:
            self._credentials = creds
            return creds

        return None

    def _get_from_keychain(self) -> Optional[ClaudeCredentials]:
        """Get credentials from macOS Keychain."""
        try:
            result = subprocess.run(
                ["security", "find-generic-password", "-s", self.KEYCHAIN_SERVICE, "-w"],
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode != 0:
                return None

            # Parse JSON from keychain
            data = json.loads(result.stdout.strip())
            return self._parse_credentials(data)

        except (subprocess.SubprocessError, json.JSONDecodeError, FileNotFoundError):
            return None

    def _get_from_file(self) -> Optional[ClaudeCredentials]:
        """Get credentials from file."""
        try:
            if not self.CREDENTIALS_FILE.exists():
                return None

            with open(self.CREDENTIALS_FILE, 'r') as f:
                data = json.load(f)

            return self._parse_credentials(data)

        except (json.JSONDecodeError, OSError):
            return None

    def _parse_credentials(self, data: dict) -> Optional[ClaudeCredentials]:
        """Parse credentials from JSON data."""
        try:
            oauth = data.get("claudeAiOauth", {})

            return ClaudeCredentials(
                access_token=oauth.get("accessToken", ""),
                refresh_token=oauth.get("refreshToken", ""),
                expires_at=oauth.get("expiresAt", 0),
                subscription_type=oauth.get("subscriptionType", "unknown"),
                rate_limit_tier=oauth.get("rateLimitTier", "unknown")
            )

        except (KeyError, TypeError):
            return None

    def is_available(self) -> bool:
        """Check if valid credentials are available."""
        creds = self.get_credentials()
        if creds is None:
            return False

        # Check if token is expired
        if creds.is_expired():
            return False

        # Check if token has valid prefix
        if not creds.access_token.startswith("sk-ant-oat01-"):
            return False

        return True


class CodexCredentialStore:
    """Manages Codex credential discovery from file."""

    CREDENTIALS_FILE = Path.home() / ".codex" / "auth.json"

    def __init__(self):
        self._credentials: Optional[CodexCredentials] = None

    def get_credentials(self) -> Optional[CodexCredentials]:
        """Get Codex credentials from file."""
        if self._credentials is not None:
            return self._credentials

        try:
            if not self.CREDENTIALS_FILE.exists():
                return None

            with open(self.CREDENTIALS_FILE, 'r') as f:
                data = json.load(f)

            tokens = data.get("tokens", {})

            creds = CodexCredentials(
                access_token=tokens.get("access_token", ""),
                refresh_token=tokens.get("refresh_token", ""),
                account_id=tokens.get("account_id", ""),
                last_refresh=data.get("last_refresh", "")
            )

            self._credentials = creds
            return creds

        except (json.JSONDecodeError, OSError, KeyError, TypeError):
            return None

    def is_available(self) -> bool:
        """Check if valid credentials are available."""
        creds = self.get_credentials()
        if creds is None:
            return False

        # Check if we have required fields
        if not creds.access_token or not creds.refresh_token:
            return False

        return True
