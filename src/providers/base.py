"""Base classes and types for usage providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional


class DataSource(Enum):
    """Source of usage data."""
    API = "api"
    PTY = "pty"
    CACHE = "cache"
    FALLBACK = "fallback"


@dataclass
class FetchResult:
    """Result of a usage data fetch operation."""
    metrics: Optional[Dict]  # Same dict format as current parsers return
    source: DataSource
    timestamp: float
    error: Optional[str] = None
    stale: bool = False

    @property
    def is_success(self) -> bool:
        """Whether the fetch was successful."""
        return self.metrics is not None and self.error is None


class UsageProvider(ABC):
    """Base class for usage data providers."""

    def __init__(self):
        self.name: str = self.__class__.__name__
        self.source_type: DataSource = DataSource.FALLBACK

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this provider can be used."""
        pass

    @abstractmethod
    def fetch(self) -> FetchResult:
        """Fetch usage data."""
        pass


class PersistentUsageProvider(UsageProvider):
    """Provider that maintains a persistent session."""

    @abstractmethod
    def start(self) -> FetchResult:
        """Start the persistent session and return initial data."""
        pass

    @abstractmethod
    def refresh(self) -> FetchResult:
        """Refresh data from the existing session."""
        pass

    @abstractmethod
    def stop(self):
        """Stop the persistent session."""
        pass
