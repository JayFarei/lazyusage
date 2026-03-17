/**
 * Factory functions for creating provider chains.
 * Port of src/providers/factory.py
 */

import { ClaudeAPIProvider } from "./api-claude.js";
import { CodexAPIProvider } from "./api-codex.js";
import { CodexSessionProvider } from "./session-codex.js";
import { FallbackChain, PersistentFallbackChain } from "./chain.js";
import {
  ClaudePTYProvider,
  ClaudePersistentPTYProvider,
  CodexPTYProvider,
  CodexPersistentPTYProvider,
} from "./pty.js";
import { ClaudeCredentialStore, CodexCredentialStore } from "./credentials.js";

/** Create Claude provider fallback chain */
export function createClaudeChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const credStore = new ClaudeCredentialStore();
    const apiProvider = new ClaudeAPIProvider(credStore);
    const ptyProvider = new ClaudePersistentPTYProvider();
    return new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
  }
  const providers = [new ClaudeAPIProvider(), new ClaudePTYProvider()];
  return new FallbackChain("claude", providers);
}

/** Create Codex provider fallback chain */
export function createCodexChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const credStore = new CodexCredentialStore();
    const apiProvider = new CodexAPIProvider();
    const ptyProvider = new CodexPersistentPTYProvider();
    return new PersistentFallbackChain("codex", apiProvider, ptyProvider, credStore);
  }
  // API -> Session files (fallback when token expires) -> PTY
  const providers = [new CodexAPIProvider(), new CodexSessionProvider(), new CodexPTYProvider()];
  return new FallbackChain("codex", providers);
}
