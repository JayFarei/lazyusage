/**
 * Factory functions for creating provider chains.
 * Port of src/providers/factory.py
 */

import type { ServiceName } from "../services.js";
import { ClaudeAPIProvider } from "./api-claude.js";
import { CodexAPIProvider } from "./api-codex.js";
import { GrokAPIProvider } from "./api-grok.js";
import { FallbackChain, PersistentFallbackChain } from "./chain.js";
import { ClaudeCredentialStore, CodexCredentialStore, GrokCredentialStore } from "./credentials.js";
import { ClaudePersistentPTYProvider, ClaudePTYProvider, CodexPersistentPTYProvider, CodexPTYProvider } from "./pty.js";
import { CodexSessionProvider } from "./session-codex.js";
import { ClaudeWebProvider } from "./web-claude.js";

/** Create Claude provider fallback chain */
export function createClaudeChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const credStore = new ClaudeCredentialStore();
    const apiProvider = new ClaudeAPIProvider(credStore);
    const webProvider = new ClaudeWebProvider();
    const ptyProvider = new ClaudePersistentPTYProvider();
    // Order: OAuth API -> Web API (browser cookies) -> PTY
    return new PersistentFallbackChain("claude", [apiProvider, webProvider, ptyProvider], credStore);
  }
  const providers = [new ClaudeAPIProvider(), new ClaudeWebProvider(), new ClaudePTYProvider()];
  return new FallbackChain("claude", providers);
}

/** Create Codex provider fallback chain */
export function createCodexChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  if (persistent) {
    const credStore = new CodexCredentialStore();
    const apiProvider = new CodexAPIProvider();
    const sessionProvider = new CodexSessionProvider();
    const ptyProvider = new CodexPersistentPTYProvider();
    // Order: API -> Session files -> PTY
    return new PersistentFallbackChain("codex", [apiProvider, sessionProvider, ptyProvider], credStore);
  }
  // API -> Session files (fallback when token expires) -> PTY
  const providers = [new CodexAPIProvider(), new CodexSessionProvider(), new CodexPTYProvider()];
  return new FallbackChain("codex", providers);
}

/** Create Grok provider fallback chain (billing API only; Grok has no PTY or local allowance source) */
export function createGrokChain(persistent: boolean = false): FallbackChain | PersistentFallbackChain {
  const credStore = new GrokCredentialStore();
  const providers = [new GrokAPIProvider(credStore)];
  return persistent ? new PersistentFallbackChain("grok", providers, credStore) : new FallbackChain("grok", providers);
}

const CHAIN_FACTORIES: Record<ServiceName, (persistent: boolean) => FallbackChain | PersistentFallbackChain> = {
  claude: createClaudeChain,
  codex: createCodexChain,
  grok: createGrokChain,
};

/** Create the provider fallback chain for any service */
export function createChain(
  service: ServiceName,
  persistent: boolean = false,
): FallbackChain | PersistentFallbackChain {
  return CHAIN_FACTORIES[service](persistent);
}
