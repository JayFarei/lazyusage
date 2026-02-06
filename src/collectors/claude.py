"""Claude CLI collectors."""

import os
import time
from typing import Dict
from .base import EphemeralCollector, PersistentCollector
from ..utils.tmux import EphemeralSession, PersistentSession
from ..parsers.claude import parse_claude_output


class ClaudeEphemeralCollector(EphemeralCollector):
    """Ephemeral collector for Claude CLI (single-shot usage)."""

    def collect(self) -> Dict[str, Dict]:
        """Collect Claude usage metrics using ephemeral tmux session.

        Returns:
            Dict with keys: 'subscription_type', 'session', 'week_all', 'week_sonnet'
        """
        session_name = f"claude-usage-{os.getpid()}"

        with EphemeralSession(session_name, "claude") as session:
            # Wait for landing page (contains subscription info)
            time.sleep(1)

            # Capture landing page for subscription
            landing_output = session.capture_output()

            # Send /usage command character-by-character
            session.send_keys("/usage", delay=0.2)

            # Send Enter
            session.send_keys("Enter", literal=True)

            # Poll until usage output appears
            usage_output = session.wait_for_content("% used", timeout=8.0)

            # Combine landing + usage for full parsing
            combined_output = landing_output + "\n" + usage_output

        # Parse and return metrics
        return parse_claude_output(combined_output)


class ClaudePersistentCollector(PersistentCollector):
    """Persistent collector for Claude CLI (live dashboard with session reuse)."""

    def __init__(self):
        self.session_name = f"claude-live-{os.getpid()}"
        self.session = PersistentSession(self.session_name, "claude")
        self.landing_output = None  # Store landing page for subscription
        self._last_good = None  # Cache last successful metrics

    def start(self) -> Dict[str, Dict]:
        """Create persistent session and collect initial metrics.

        Windup phase: Create session → capture landing → execute /usage

        Returns:
            Dict with keys: 'subscription_type', 'session', 'week_all', 'week_sonnet'
        """
        # Create session and wait for prompt
        self.session.windup()

        # Capture landing page (has subscription info)
        time.sleep(1)
        self.landing_output = self.session.capture_output()

        # Execute /usage command
        self.session.send_keys("/usage", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Poll until usage output appears
        usage_output = self.session.wait_for_content("% used", timeout=8.0)

        # Combine landing + usage for full parsing
        combined_output = self.landing_output + "\n" + usage_output

        metrics = parse_claude_output(combined_output)
        if self._has_real_data(metrics):
            self._last_good = metrics
        return metrics

    def _has_real_data(self, metrics: Dict[str, Dict]) -> bool:
        """Check if metrics contain real parsed data (not all None/fallback)."""
        for key in ("session", "week_all", "week_sonnet"):
            entry = metrics.get(key, {})
            if entry.get("percent_used") is not None:
                return True
        return False

    def refresh(self) -> Dict[str, Dict]:
        """Refresh metrics from existing session.

        Recurrent polling phase:
        1. Press ESC to return to prompt (if not already there)
        2. Execute /usage command
        3. Poll for output

        Returns:
            Dict with keys: 'subscription_type', 'session', 'week_all', 'week_sonnet'
        """
        # Press ESC to return to prompt
        self.session.send_keys("Escape", literal=True)
        time.sleep(0.5)

        # Execute /usage command
        self.session.send_keys("/usage", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Poll until usage output appears
        usage_output = self.session.wait_for_content("% used", timeout=8.0)

        # Combine stored landing + new usage for full parsing
        combined_output = (self.landing_output or "") + "\n" + usage_output

        metrics = parse_claude_output(combined_output)
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
