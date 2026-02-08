"""Fallback chain orchestrator for multi-source data fetching."""

from typing import List, Optional

from .base import DataSource, FetchResult, UsageProvider, PersistentUsageProvider
from .cache import UsageCache


class FallbackChain:
    """Orchestrates fallback chain: API -> PTY -> Cache -> Default zeros."""

    def __init__(self, service: str, providers: List[UsageProvider]):
        """
        Initialize fallback chain.

        Args:
            service: Service name ('claude' or 'codex')
            providers: List of providers in fallback order
        """
        self.service = service
        self.providers = providers
        self.cache = UsageCache(service)
        self._last_result: Optional[FetchResult] = None

    def fetch(self) -> FetchResult:
        """
        Fetch data with fallback chain.

        Tries providers in order until one succeeds. Caches successful results.
        Returns cached data if all providers fail.
        """
        # Try each provider in order
        for provider in self.providers:
            if not provider.is_available():
                continue

            result = provider.fetch()

            if result.is_success:
                # Cache successful result
                self.cache.store(result.metrics, result.timestamp)
                self._last_result = result
                return result

        # All providers failed, try cache
        cache_result = self.cache.fetch()
        if cache_result.is_success:
            self._last_result = cache_result
            return cache_result

        # Return fallback zeros
        fallback_result = self._create_fallback_result()
        self._last_result = fallback_result
        return fallback_result

    def _create_fallback_result(self) -> FetchResult:
        """Create fallback result with zero metrics."""
        import time
        from ..utils.time import calculate_fallback_time

        # Service-specific fallback metrics
        if self.service == 'claude':
            metrics = {
                'subscription_type': 'Unknown',
                'session': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(5, same_day=True),
                },
                'week_all': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),  # 7 days
                },
                'week_sonnet': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),
                },
            }
        else:  # codex
            metrics = {
                'subscription_type': 'Unknown',
                '5h': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(5, same_day=True),
                },
                'weekly': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),
                },
            }

        return FetchResult(
            metrics=metrics,
            source=DataSource.FALLBACK,
            timestamp=time.time(),
            error="All providers failed, using fallback zeros"
        )

    def get_last_result(self) -> Optional[FetchResult]:
        """Get the last fetch result."""
        return self._last_result


class PersistentFallbackChain:
    """Fallback chain for persistent providers (used by TUI)."""

    def __init__(
        self,
        service: str,
        api_provider: Optional[UsageProvider],
        pty_provider: PersistentUsageProvider
    ):
        """
        Initialize persistent fallback chain.

        Args:
            service: Service name ('claude' or 'codex')
            api_provider: Optional API provider (ephemeral)
            pty_provider: Persistent PTY provider
        """
        self.service = service
        self.api_provider = api_provider
        self.pty_provider = pty_provider
        self.cache = UsageCache(service)
        self._last_result: Optional[FetchResult] = None
        self._pty_started = False

    def start(self) -> FetchResult:
        """
        Start the chain and get initial data.

        Tries API first, falls back to starting PTY session.
        """
        # Try API first (if available)
        if self.api_provider is not None and self.api_provider.is_available():
            result = self.api_provider.fetch()
            if result.is_success:
                self.cache.store(result.metrics, result.timestamp)
                self._last_result = result
                return result

        # Fallback to PTY
        result = self.pty_provider.start()
        self._pty_started = True

        if result.is_success:
            self.cache.store(result.metrics, result.timestamp)
            self._last_result = result
            return result

        # Try cache as last resort
        cache_result = self.cache.fetch()
        if cache_result.is_success:
            self._last_result = cache_result
            return cache_result

        # Return fallback
        fallback_result = self._create_fallback_result()
        self._last_result = fallback_result
        return fallback_result

    def refresh(self) -> FetchResult:
        """
        Refresh data.

        Tries API first, falls back to PTY refresh.
        """
        # Try API first (if available)
        if self.api_provider is not None and self.api_provider.is_available():
            result = self.api_provider.fetch()
            if result.is_success:
                self.cache.store(result.metrics, result.timestamp)
                self._last_result = result
                return result

        # Fallback to PTY refresh
        if not self._pty_started:
            # If PTY wasn't started yet, start it now
            return self.start()

        result = self.pty_provider.refresh()

        if result.is_success and not result.stale:
            self.cache.store(result.metrics, result.timestamp)
            self._last_result = result
            return result

        # If PTY failed or returned stale data, try cache
        cache_result = self.cache.fetch()
        if cache_result.is_success:
            self._last_result = cache_result
            return cache_result

        # Return last good result if available
        if self._last_result is not None and self._last_result.is_success:
            # Mark it as stale
            stale_result = FetchResult(
                metrics=self._last_result.metrics,
                source=self._last_result.source,
                timestamp=self._last_result.timestamp,
                error=self._last_result.error,
                stale=True
            )
            return stale_result

        # Return fallback
        fallback_result = self._create_fallback_result()
        self._last_result = fallback_result
        return fallback_result

    def stop(self):
        """Stop the chain and cleanup."""
        if self._pty_started:
            self.pty_provider.stop()
            self._pty_started = False

    def get_last_result(self) -> Optional[FetchResult]:
        """Get the last fetch result."""
        return self._last_result

    def _create_fallback_result(self) -> FetchResult:
        """Create fallback result with zero metrics."""
        import time
        from ..utils.time import calculate_fallback_time

        # Service-specific fallback metrics
        if self.service == 'claude':
            metrics = {
                'subscription_type': 'Unknown',
                'session': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(5, same_day=True),
                },
                'week_all': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),
                },
                'week_sonnet': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),
                },
            }
        else:  # codex
            metrics = {
                'subscription_type': 'Unknown',
                '5h': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(5, same_day=True),
                },
                'weekly': {
                    'used_pct': 0,
                    'remaining_pct': 100,
                    'resets': calculate_fallback_time(168, same_day=False),
                },
            }

        return FetchResult(
            metrics=metrics,
            source=DataSource.FALLBACK,
            timestamp=time.time(),
            error="All providers failed, using fallback zeros"
        )
