"""Factory functions for creating provider chains."""

from .api import ClaudeAPIProvider, CodexAPIProvider
from .chain import FallbackChain, PersistentFallbackChain
from .pty import (
    ClaudePTYProvider,
    ClaudePersistentPTYProvider,
    CodexPTYProvider,
    CodexPersistentPTYProvider,
)


def create_claude_chain(persistent: bool = False):
    """
    Create Claude provider fallback chain.

    Args:
        persistent: If True, create persistent chain for TUI use.
                   If False, create ephemeral chain for CLI use.

    Returns:
        FallbackChain or PersistentFallbackChain
    """
    if persistent:
        api_provider = ClaudeAPIProvider()
        pty_provider = ClaudePersistentPTYProvider()
        return PersistentFallbackChain('claude', api_provider, pty_provider)
    else:
        providers = [
            ClaudeAPIProvider(),
            ClaudePTYProvider(),
        ]
        return FallbackChain('claude', providers)


def create_codex_chain(persistent: bool = False):
    """
    Create Codex provider fallback chain.

    Args:
        persistent: If True, create persistent chain for TUI use.
                   If False, create ephemeral chain for CLI use.

    Returns:
        FallbackChain or PersistentFallbackChain
    """
    if persistent:
        api_provider = CodexAPIProvider()
        pty_provider = CodexPersistentPTYProvider()
        return PersistentFallbackChain('codex', api_provider, pty_provider)
    else:
        providers = [
            CodexAPIProvider(),
            CodexPTYProvider(),
        ]
        return FallbackChain('codex', providers)
