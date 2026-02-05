"""Codex CLI collectors."""

import os
import time
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

            # Wait for command to execute and display results
            time.sleep(2)

            # Capture output
            output = session.capture_output()

        # Parse and return metrics
        return parse_codex_output(output)


class CodexPersistentCollector(PersistentCollector):
    """Persistent collector for Codex CLI (live dashboard with session reuse)."""

    def __init__(self):
        self.session_name = f"codex-live-{os.getpid()}"
        self.session = PersistentSession(self.session_name, "codex")

    def start(self) -> Dict[str, Dict]:
        """Create persistent session and collect initial metrics.

        Windup phase: Create session → execute /status → capture latest response

        Returns:
            Dict with keys: '5h', 'weekly'
        """
        # Create session and wait for prompt
        self.session.windup()

        # Execute /status command
        self.session.send_keys("/status", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Wait for response to appear
        time.sleep(1)

        # Capture output (latest response in chat history)
        output = self.session.capture_output()

        return parse_codex_output(output)

    def refresh(self) -> Dict[str, Dict]:
        """Refresh metrics from existing session.

        Recurrent polling phase:
        1. Re-enter /status command
        2. Capture latest response from chat history

        Returns:
            Dict with keys: '5h', 'weekly'
        """
        # Execute /status command (no need to exit previous command)
        self.session.send_keys("/status", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Wait for response to appear
        time.sleep(1)

        # Capture output (latest response in chat history)
        output = self.session.capture_output()

        return parse_codex_output(output)

    def stop(self):
        """Stop persistent session and cleanup."""
        self.session.winddown()
