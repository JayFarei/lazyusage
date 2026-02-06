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

            # Wait for command to execute and display results
            time.sleep(2)

            # Capture usage output
            usage_output = session.capture_output()

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

        # Wait for usage output to display
        time.sleep(2)

        # Capture usage output
        usage_output = self.session.capture_output()

        # Combine landing + usage for full parsing
        combined_output = self.landing_output + "\n" + usage_output

        return parse_claude_output(combined_output)

    def refresh(self) -> Dict[str, Dict]:
        """Refresh metrics from existing session.

        Recurrent polling phase:
        1. Press ESC to return to prompt (if not already there)
        2. Execute /usage command
        3. Capture output

        Returns:
            Dict with keys: 'subscription_type', 'session', 'week_all', 'week_sonnet'
        """
        # Press ESC to return to prompt
        self.session.send_keys("Escape", literal=True)
        time.sleep(0.5)

        # Execute /usage command
        self.session.send_keys("/usage", delay=0.2)
        self.session.send_keys("Enter", literal=True)

        # Wait for usage output to display
        time.sleep(2)

        # Capture usage output
        usage_output = self.session.capture_output()

        # Combine stored landing + new usage for full parsing
        combined_output = (self.landing_output or "") + "\n" + usage_output

        return parse_claude_output(combined_output)

    def stop(self):
        """Stop persistent session and cleanup."""
        self.session.winddown()
