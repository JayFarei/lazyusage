"""Base collector classes."""

from abc import ABC, abstractmethod
from typing import Dict


class EphemeralCollector(ABC):
    """Abstract base class for ephemeral (one-shot) collectors."""

    @abstractmethod
    def collect(self) -> Dict[str, Dict]:
        """Collect usage metrics in a single-shot operation.

        Returns:
            Dict of metrics
        """
        pass


class PersistentCollector(ABC):
    """Abstract base class for persistent (reusable session) collectors."""

    @abstractmethod
    def start(self) -> Dict[str, Dict]:
        """Start persistent session and collect initial metrics.

        Returns:
            Dict of metrics
        """
        pass

    @abstractmethod
    def refresh(self) -> Dict[str, Dict]:
        """Refresh metrics from existing session.

        Returns:
            Dict of metrics
        """
        pass

    @abstractmethod
    def stop(self):
        """Stop persistent session and cleanup."""
        pass
