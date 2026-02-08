"""PTY-based usage providers wrapping existing collectors."""

import time
from typing import Optional

from .base import DataSource, FetchResult, UsageProvider, PersistentUsageProvider
from ..collectors.claude import ClaudeEphemeralCollector, ClaudePersistentCollector
from ..collectors.codex import CodexEphemeralCollector, CodexPersistentCollector


class ClaudePTYProvider(UsageProvider):
    """Ephemeral PTY-based Claude usage provider."""

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.PTY
        self._collector = ClaudeEphemeralCollector()

    def is_available(self) -> bool:
        """PTY is always available (depends on CLI being in PATH)."""
        return True

    def fetch(self) -> FetchResult:
        """Fetch usage data via ephemeral tmux session."""
        timestamp = time.time()

        try:
            metrics = self._collector.collect()

            # Check if we got valid data
            if not metrics or all(v.get('used_pct', -1) == 0 for v in metrics.values() if isinstance(v, dict)):
                # Empty metrics likely means stale session
                return FetchResult(
                    metrics=metrics,
                    source=self.source_type,
                    timestamp=timestamp,
                    error="Empty metrics returned (possibly stale session)",
                    stale=True
                )

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY collection failed: {str(e)}"
            )


class ClaudePersistentPTYProvider(PersistentUsageProvider):
    """Persistent PTY-based Claude usage provider."""

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.PTY
        self._collector = ClaudePersistentCollector()

    def is_available(self) -> bool:
        """PTY is always available (depends on CLI being in PATH)."""
        return True

    def start(self) -> FetchResult:
        """Start persistent tmux session and get initial data."""
        timestamp = time.time()

        try:
            metrics = self._collector.start()

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY start failed: {str(e)}"
            )

    def refresh(self) -> FetchResult:
        """Refresh data from existing tmux session."""
        timestamp = time.time()

        try:
            metrics = self._collector.refresh()

            # Check if we got valid data
            if not metrics or all(v.get('used_pct', -1) == 0 for v in metrics.values() if isinstance(v, dict)):
                return FetchResult(
                    metrics=metrics,
                    source=self.source_type,
                    timestamp=timestamp,
                    error="Empty metrics returned (possibly stale session)",
                    stale=True
                )

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY refresh failed: {str(e)}"
            )

    def stop(self):
        """Stop persistent tmux session."""
        try:
            self._collector.stop()
        except Exception:
            # Best effort cleanup
            pass

    def fetch(self) -> FetchResult:
        """Fetch is not supported for persistent provider, use refresh instead."""
        return FetchResult(
            metrics=None,
            source=self.source_type,
            timestamp=time.time(),
            error="Use start() and refresh() for persistent provider"
        )


class CodexPTYProvider(UsageProvider):
    """Ephemeral PTY-based Codex usage provider."""

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.PTY
        self._collector = CodexEphemeralCollector()

    def is_available(self) -> bool:
        """PTY is always available (depends on CLI being in PATH)."""
        return True

    def fetch(self) -> FetchResult:
        """Fetch usage data via ephemeral tmux session."""
        timestamp = time.time()

        try:
            metrics = self._collector.collect()

            # Check if we got valid data
            if not metrics or all(v.get('used_pct', -1) == 0 for v in metrics.values() if isinstance(v, dict)):
                return FetchResult(
                    metrics=metrics,
                    source=self.source_type,
                    timestamp=timestamp,
                    error="Empty metrics returned (possibly stale session)",
                    stale=True
                )

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY collection failed: {str(e)}"
            )


class CodexPersistentPTYProvider(PersistentUsageProvider):
    """Persistent PTY-based Codex usage provider."""

    def __init__(self):
        super().__init__()
        self.source_type = DataSource.PTY
        self._collector = CodexPersistentCollector()

    def is_available(self) -> bool:
        """PTY is always available (depends on CLI being in PATH)."""
        return True

    def start(self) -> FetchResult:
        """Start persistent tmux session and get initial data."""
        timestamp = time.time()

        try:
            metrics = self._collector.start()

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY start failed: {str(e)}"
            )

    def refresh(self) -> FetchResult:
        """Refresh data from existing tmux session."""
        timestamp = time.time()

        try:
            metrics = self._collector.refresh()

            # Check if we got valid data
            if not metrics or all(v.get('used_pct', -1) == 0 for v in metrics.values() if isinstance(v, dict)):
                return FetchResult(
                    metrics=metrics,
                    source=self.source_type,
                    timestamp=timestamp,
                    error="Empty metrics returned (possibly stale session)",
                    stale=True
                )

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=timestamp,
                error=None
            )

        except Exception as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"PTY refresh failed: {str(e)}"
            )

    def stop(self):
        """Stop persistent tmux session."""
        try:
            self._collector.stop()
        except Exception:
            # Best effort cleanup
            pass

    def fetch(self) -> FetchResult:
        """Fetch is not supported for persistent provider, use refresh instead."""
        return FetchResult(
            metrics=None,
            source=self.source_type,
            timestamp=time.time(),
            error="Use start() and refresh() for persistent provider"
        )
