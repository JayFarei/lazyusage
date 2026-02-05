"""Tmux session management for CLI usage monitoring."""

import subprocess
import time
import os
from typing import Optional


class EphemeralSession:
    """Ephemeral tmux session for one-shot usage collection."""

    def __init__(self, session_name: str, command: str):
        self.session_name = session_name
        self.command = command
        self.session = None

    def __enter__(self):
        """Create detached tmux session."""
        # Create detached session
        subprocess.run(
            ["tmux", "new-session", "-d", "-s", self.session_name, self.command],
            check=True
        )
        # Give CLI time to start
        time.sleep(2)
        return self

    def send_keys(self, keys: str, delay: float = 0.2, literal: bool = False):
        """Send keys to tmux session.

        Args:
            keys: Keys to send
            delay: Delay between characters (for character-by-character input)
            literal: If True, send keys literally. If False, send character-by-character.
        """
        if literal:
            # Send keys as-is (for special keys like Enter, Escape)
            subprocess.run(
                ["tmux", "send-keys", "-t", self.session_name, keys],
                check=True
            )
        else:
            # Send character-by-character to avoid autocomplete
            for char in keys:
                subprocess.run(
                    ["tmux", "send-keys", "-t", self.session_name, "-l", char],
                    check=True
                )
                time.sleep(delay)

        # Always wait after sending keys
        time.sleep(0.5)

    def capture_output(self) -> str:
        """Capture tmux pane output."""
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", self.session_name, "-p"],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout

    def cleanup(self):
        """Kill tmux session."""
        try:
            subprocess.run(
                ["tmux", "kill-session", "-t", self.session_name],
                stderr=subprocess.DEVNULL
            )
        except subprocess.CalledProcessError:
            # Session might already be dead
            pass

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Cleanup session on exit."""
        self.cleanup()


class PersistentSession:
    """Persistent tmux session for live dashboard with reusable session."""

    def __init__(self, session_name: str, command: str):
        self.session_name = session_name
        self.command = command
        self.session_started = False

    def windup(self):
        """Create session and wait for initial prompt."""
        # Create detached session
        subprocess.run(
            ["tmux", "new-session", "-d", "-s", self.session_name, self.command],
            check=True
        )
        # Give CLI time to start and show prompt
        time.sleep(2)
        self.session_started = True

    def send_keys(self, keys: str, delay: float = 0.2, literal: bool = False):
        """Send keys to tmux session (same as EphemeralSession)."""
        if literal:
            subprocess.run(
                ["tmux", "send-keys", "-t", self.session_name, keys],
                check=True
            )
        else:
            for char in keys:
                subprocess.run(
                    ["tmux", "send-keys", "-t", self.session_name, "-l", char],
                    check=True
                )
                time.sleep(delay)

        time.sleep(0.5)

    def capture_output(self) -> str:
        """Capture tmux pane output."""
        result = subprocess.run(
            ["tmux", "capture-pane", "-t", self.session_name, "-p"],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout

    def winddown(self):
        """Kill tmux session."""
        if self.session_started:
            try:
                subprocess.run(
                    ["tmux", "kill-session", "-t", self.session_name],
                    stderr=subprocess.DEVNULL
                )
            except subprocess.CalledProcessError:
                pass
            self.session_started = False
