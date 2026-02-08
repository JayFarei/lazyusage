"""API-based usage providers for Claude and Codex."""

import time
from typing import Dict, Optional

import requests

from .base import DataSource, FetchResult, UsageProvider
from .credentials import ClaudeCredentialStore, CodexCredentialStore
from ..utils.time import format_reset_from_iso


class ClaudeAPIProvider(UsageProvider):
    """Fetches Claude usage data from the OAuth API."""

    API_URL = "https://api.anthropic.com/api/oauth/usage"

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.API
        self._credentials_store = ClaudeCredentialStore()

    def is_available(self) -> bool:
        """Check if API credentials are available and valid."""
        return self._credentials_store.is_available()

    def fetch(self) -> FetchResult:
        """Fetch usage data from Claude OAuth API."""
        timestamp = time.time()

        # Check credentials
        creds = self._credentials_store.get_credentials()
        if creds is None:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error="No credentials available"
            )

        # Make API request
        try:
            headers = {
                "Authorization": f"Bearer {creds.access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "anthropic-beta": "oauth-2025-04-20",
                "User-Agent": "claude-code/2.0.32",
            }

            response = requests.get(
                self.API_URL,
                headers=headers,
                timeout=10
            )

            response.raise_for_status()
            data = response.json()

            # Parse response
            metrics = self._parse_api_response(data, creds.subscription_type)

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except requests.RequestException as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"API request failed: {str(e)}"
            )

        except (KeyError, ValueError) as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"Failed to parse API response: {str(e)}"
            )

    def _parse_api_response(self, data: dict, subscription_type: str) -> dict:
        """Parse API response to metrics dict format.

        Maps API schema to our internal format:
        - five_hour -> session (5-hour rolling window)
        - seven_day -> week_all (all models weekly)
        - seven_day_sonnet -> week_sonnet (Sonnet-specific weekly)
        """
        five_hour = data.get("five_hour") or {}
        seven_day = data.get("seven_day") or {}
        seven_day_sonnet = data.get("seven_day_sonnet") or {}

        # Helper to safely convert utilization to int
        def get_utilization(window: dict) -> int:
            if window is None or not isinstance(window, dict):
                return 0
            util = window.get("utilization", 0)
            # Handle None or null values
            if util is None:
                return 0
            return int(util)

        session_used = get_utilization(five_hour)
        week_all_used = get_utilization(seven_day)
        week_sonnet_used = get_utilization(seven_day_sonnet)

        return {
            'subscription_type': subscription_type,
            'session': {
                'used_pct': session_used,
                'remaining_pct': 100 - session_used,
                'resets': format_reset_from_iso(five_hour.get("resets_at")),
            },
            'week_all': {
                'used_pct': week_all_used,
                'remaining_pct': 100 - week_all_used,
                'resets': format_reset_from_iso(seven_day.get("resets_at")),
            },
            'week_sonnet': {
                'used_pct': week_sonnet_used,
                'remaining_pct': 100 - week_sonnet_used,
                'resets': format_reset_from_iso(seven_day_sonnet.get("resets_at")),
            },
        }


class CodexAPIProvider(UsageProvider):
    """Fetches Codex usage data from the ChatGPT API."""

    API_URL = "https://chatgpt.com/backend-api/wham/usage"

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.API
        self._credentials_store = CodexCredentialStore()

    def is_available(self) -> bool:
        """Check if API credentials are available."""
        return self._credentials_store.is_available()

    def fetch(self) -> FetchResult:
        """Fetch usage data from Codex API."""
        timestamp = time.time()

        # Check credentials
        creds = self._credentials_store.get_credentials()
        if creds is None:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error="No credentials available"
            )

        # Make API request
        try:
            headers = {
                "Authorization": f"Bearer {creds.access_token}",
                "Accept": "application/json",
            }

            response = requests.get(
                self.API_URL,
                headers=headers,
                timeout=10
            )

            response.raise_for_status()
            data = response.json()

            # Parse response
            metrics = self._parse_api_response(data)

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except requests.RequestException as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"API request failed: {str(e)}"
            )

        except (KeyError, ValueError) as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"Failed to parse API response: {str(e)}"
            )

    def _parse_api_response(self, data: dict) -> dict:
        """Parse API response to metrics dict format.

        Maps API schema to our internal format:
        - rate_limit.primary_window -> 5h (5-hour rolling window)
        - rate_limit.secondary_window -> weekly
        """
        from datetime import datetime

        # Extract rate_limit data
        rate_limit = data.get("rate_limit", {})
        primary = rate_limit.get("primary_window", {})
        secondary = rate_limit.get("secondary_window", {})
        plan = data.get("plan_type", "unknown")

        # Map plan_type to our subscription format
        sub_map = {
            "plus": "Plus",
            "pro": "Pro",
            "free": "Free",
            "go": "Go",
            "team": "Team",
            "business": "Business",
            "enterprise": "Enterprise",
        }

        # Helper to safely get percentage
        def get_percent(window: dict) -> int:
            pct = window.get("used_percent", 0)
            if pct is None:
                return 0
            return int(pct)

        # Helper to convert Unix timestamp to ISO format
        def unix_to_iso(timestamp) -> str:
            if timestamp is None:
                return None
            try:
                dt = datetime.utcfromtimestamp(int(timestamp))
                return dt.isoformat() + 'Z'
            except (ValueError, TypeError):
                return None

        five_hour_used = get_percent(primary)
        weekly_used = get_percent(secondary)

        return {
            'subscription_type': sub_map.get(plan, plan),
            '5h': {
                'used_pct': five_hour_used,
                'remaining_pct': 100 - five_hour_used,
                'resets': format_reset_from_iso(unix_to_iso(primary.get("reset_at"))),
            },
            'weekly': {
                'used_pct': weekly_used,
                'remaining_pct': 100 - weekly_used,
                'resets': format_reset_from_iso(unix_to_iso(secondary.get("reset_at"))),
            },
        }
