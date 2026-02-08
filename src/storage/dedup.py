"""Hybrid deduplication strategy for usage snapshots."""

import time
from typing import Dict, Optional


class DedupTracker:
    """Tracks last stored snapshots for deduplication."""

    HEARTBEAT_INTERVAL = 60  # Store every 60s even if no change

    def __init__(self):
        """Initialize tracker."""
        self._last_stored = {}  # service -> {metric_name: (used_pct, timestamp)}

    def should_store(
        self,
        service: str,
        metric_name: str,
        used_pct: int
    ) -> bool:
        """
        Determine if snapshot should be stored.

        Stores if:
        1. Value changed from last stored value, OR
        2. >= 60s since last store (heartbeat)

        Args:
            service: Service name ('claude' or 'codex')
            metric_name: Metric name (e.g., 'session', '5h')
            used_pct: Current usage percentage

        Returns:
            True if snapshot should be stored
        """
        key = f"{service}:{metric_name}"
        now = time.time()

        # Check if we have previous data for this metric
        if key not in self._last_stored:
            # First time seeing this metric, store it
            self._last_stored[key] = (used_pct, now)
            return True

        last_pct, last_time = self._last_stored[key]

        # Check if value changed
        if used_pct != last_pct:
            self._last_stored[key] = (used_pct, now)
            return True

        # Check if heartbeat interval elapsed
        if (now - last_time) >= self.HEARTBEAT_INTERVAL:
            self._last_stored[key] = (used_pct, now)
            return True

        # No change and within heartbeat interval, skip
        return False

    def should_store_metrics(
        self,
        service: str,
        metrics: Dict
    ) -> bool:
        """
        Check if any metric in the dict should be stored.

        Args:
            service: Service name
            metrics: Metrics dict

        Returns:
            True if at least one metric should be stored
        """
        for metric_name, metric_data in metrics.items():
            # Skip subscription_type key
            if metric_name == 'subscription_type' or not isinstance(metric_data, dict):
                continue

            used_pct = metric_data.get('used_pct', 0)

            if self.should_store(service, metric_name, used_pct):
                return True

        return False

    def clear(self):
        """Clear tracking data."""
        self._last_stored.clear()
