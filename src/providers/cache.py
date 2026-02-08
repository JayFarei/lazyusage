"""Filesystem-based cache for last-good usage data."""

import json
import time
from pathlib import Path
from typing import Dict, Optional

from .base import DataSource, FetchResult, UsageProvider


class UsageCache(UsageProvider):
    """Caches last successful usage data to filesystem."""

    CACHE_DIR = Path.home() / ".cache" / "usage-cli"
    STALE_THRESHOLD = 300  # 5 minutes

    def __init__(self, service: str):
        """
        Initialize cache for a service.

        Args:
            service: Service name ('claude' or 'codex')
        """
        super().__init__()
        self.service = service
        self.source_type = DataSource.CACHE
        self.cache_file = self.CACHE_DIR / f"{service}.json"

        # Ensure cache directory exists
        self.CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def is_available(self) -> bool:
        """Check if cache file exists."""
        return self.cache_file.exists()

    def fetch(self) -> FetchResult:
        """Fetch data from cache."""
        timestamp = time.time()

        if not self.cache_file.exists():
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error="Cache file does not exist"
            )

        try:
            with open(self.cache_file, 'r') as f:
                data = json.load(f)

            cached_timestamp = data.get("timestamp", 0)
            metrics = data.get("metrics")

            # Check if cache is stale
            age = timestamp - cached_timestamp
            is_stale = age > self.STALE_THRESHOLD

            return FetchResult(
                metrics=metrics,
                source=self.source_type,
                timestamp=cached_timestamp,
                error=None,
                stale=is_stale
            )

        except (json.JSONDecodeError, OSError) as e:
            return FetchResult(
                metrics=None,
                source=self.source_type,
                timestamp=timestamp,
                error=f"Failed to read cache: {str(e)}"
            )

    def store(self, metrics: Dict, timestamp: float):
        """
        Store metrics to cache.

        Args:
            metrics: Metrics dict to cache
            timestamp: Timestamp of the data
        """
        try:
            data = {
                "timestamp": timestamp,
                "metrics": metrics,
            }

            with open(self.cache_file, 'w') as f:
                json.dump(data, f, indent=2)

        except OSError:
            # Silently fail, cache is best-effort
            pass

    def clear(self):
        """Clear the cache file."""
        try:
            if self.cache_file.exists():
                self.cache_file.unlink()
        except OSError:
            pass
