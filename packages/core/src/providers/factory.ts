/**
 * Factory functions for creating provider chains.
 * Port of src/providers/factory.py
 */

import { ClaudeAPIProvider } from "./api-claude.js";
import { CodexAPIProvider } from "./api-codex.js";
import { FallbackChain, PersistentFallbackChain } from "./chain.js";
import {
  ClaudePTYProvider,
  ClaudePersistentPTYProvider,
  CodexPTYProvider,
  CodexPersistentPTYProvider,
} from "./pty.js";

/** Create Claude provider fallback chain */
export function createClaudeChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const apiProvider = new ClaudeAPIProvider();
    const ptyProvider = new ClaudePersistentPTYProvider();
    return new PersistentFallbackChain("claude", apiProvider, ptyProvider);
  }
  const providers = [new ClaudeAPIProvider(), new ClaudePTYProvider()];
  return new FallbackChain("claude", providers);
}

/** Create Codex provider fallback chain */
export function createCodexChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const apiProvider = new CodexAPIProvider();
    const ptyProvider = new CodexPersistentPTYProvider();
    return new PersistentFallbackChain("codex", apiProvider, ptyProvider);
  }
  const providers = [new CodexAPIProvider(), new CodexPTYProvider()];
  return new FallbackChain("codex", providers);
}
