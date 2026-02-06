"""Codex CLI collectors."""

import os
from typing import Dict
from .base import EphemeralCollector, PersistentCollector
from ..utils.tmux import EphemeralSession, PersistentSession
from ..parsers.codex import parse_codex_output


class CodexEphemeralCollector(EphemeralCollector):
    """Ephemeral collector for Codex CLI (single-shot usage)."""

    def collect(self) -> Dict[str, Dict]:
        """Collect Codex usage metrics using ephemeral tmux session.

        Returns:
            Dict with keys: '5h', 'weekly'
        """
        session_name = f"codex-usage-{os.getpid()}"

        with EphemeralSession(session_name, "codex") as session:
            # Send /status command character-by-character
            session.send_keys("/status", delay=0.2)

            # Send Enter
            session.send_keys("Enter", literal=True)

            # Poll until status output appears
            output = session.wait_for_content("limit:", timeout=8.0)

        # Parse and return metrics
        return parse_codex_output(output)


class CodexPersistentCollector(PersistentCollector):
    """Persistent collector for Codex CLI (live dashboard with session reuse)."""

    def __init__(self):
        self.session_name = f"codex-live-{os.getpid()}"
        self.session = PersistentSession(self.session_name, "codex")
        self._last_good = None  # Cache last successful metrics

    def start(self) -> Dict[str, Dict]:
        """Create persistent session and collect initial metrics.

        Windup phase: Create session → execute /status → poll for response

        Returns:
            Dict with keys: '5h', 'weekly'
        """
        # Create session and wait for prompt
        self.session.windup()

        # Execute /status command
        self.session.send_keys("/status", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Poll until status output appears
        output = self.session.wait_for_content("limit:", timeout=8.0)

        metrics = parse_codex_output(output)
        if self._has_real_data(metrics):
            self._last_good = metrics
        return metrics

    def _has_real_data(self, metrics: Dict[str, Dict]) -> bool:
        """Check if metrics contain real parsed data (not all None/fallback)."""
        for key in ("5h", "weekly"):
            entry = metrics.get(key, {})
            if entry.get("percent_used") is not None:
                return True
        return False

    def refresh(self) -> Dict[str, Dict]:
        """Refresh metrics from existing session.

        Recurrent polling phase:
        1. Re-enter /status command
        2. Poll for response

        Returns:
            Dict with keys: '5h', 'weekly'
        """
        # Execute /status command (no need to exit previous command)
        self.session.send_keys("/status", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Poll until status output appears
        output = self.session.wait_for_content("limit:", timeout=8.0)

        metrics = parse_codex_output(output)
        if self._has_real_data(metrics):
            self._last_good = metrics
            return metrics

        # If capture failed, return last known good metrics
        if self._last_good is not None:
            return self._last_good

        return metrics

    def stop(self):
        """Stop persistent session and cleanup."""
        self.session.winddown()
