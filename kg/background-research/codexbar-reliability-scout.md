# CodexBar Reliability Scout: R&D Scouting Brief

> Research date: 2026-04-08
> Source: https://github.com/steipete/CodexBar
> Category: macOS menu bar app (Swift), usage monitoring for Claude + Codex CLI
> Focus: Recent 2-week commits (v0.20-v0.21dev) cross-referenced against our `packages/core/src/parsers/`

---

## Overview

CodexBar is a macOS menu bar app (Swift/SwiftUI) that monitors Claude and Codex CLI usage via three data paths: OAuth API, browser cookies, and PTY scraping. It recently shipped major reliability fixes for token counting accuracy that directly map to gaps in our TypeScript parser stack.

## Key Commits Analyzed (Last 2 Weeks)

| Commit | Title | Relevance |
|--------|-------|-----------|
| `91146a2` | Fix Claude token and cost inflation from cross-file duplicate counting | **CRITICAL** - we have this exact bug |
| `0f7d071` | Harden PTY post-exit drain classification | Medium - our PTY path is different |
| `9bb4174` | Drain trailing PTY output after process exit | Medium - same |
| `c23edb9` | Merge pi session usage into provider history | Low - pi agent source |
| `6c0adfc` | Fix pi cost history review feedback | Low - accumulator fix |
| `dd54e34` | Fix z.ai menu bar 5-hour lane selection | Low - UI-specific |

---

## Cross-Reference: CodexBar vs Our Parsers

### Gap 1: Cross-File Duplicate Counting (CRITICAL)

**CodexBar fix (91146a2):** Claude subagent JSONL files mirror parent session logs, causing ~2x token inflation. Fixed with:
- `ClaudeUsageRow` struct storing `sessionId:messageId:requestId` as canonical dedup key
- Cross-file dedup pass in `rebuildClaudeDays`
- Winner selection: sidechain > subagent path > parent path > lexicographic

**Our code (`claude-parser.ts:65`):** We skip `isSidechain === true` events, which prevents counting sidechain duplicates. But we do NOT handle the case where parent session files contain the same events as subagent session files. If a project uses subagents (tools-within-tools), the parent's JSONL mirrors the subagent's JSONL with `isSidechain: false`, and both get counted.

**Impact:** ~2x token inflation for any Claude session using subagents (increasingly common with tool use).

### Gap 2: Codex Session Deduplication (HIGH)

**CodexBar:** Deduplicates Codex sessions by `session_id` and file inode (`fileResourceIdentifier`) across `sessions/` and `archived_sessions/` directories. Handles both date-partitioned (`YYYY/MM/DD/*.jsonl`) and flat layouts.

**Our code (`codex-parser.ts`):** No deduplication at all. If the same session appears in both `sessions/` and `archived_sessions/` (which Codex does when archiving), we count it twice. We also only scan `sessions/` and miss `archived_sessions/`.

**Impact:** Potential double-counting for archived Codex sessions.

### Gap 3: Incremental File Parsing (MEDIUM)

**CodexBar:** Tracks `parsedBytes` offset per file. When a file grows (new events appended), only the new tail is parsed and merged with existing cached data.

**Our code:** Cache invalidation is mtime-based. Any change to a file causes a full re-parse from byte 0. For large session files (100K+ events), this is wasteful.

**Impact:** Performance, not correctness. Noticeable during heavy usage when session files grow continuously.

### Gap 4: Cache Eviction vs Session Date Mismatch (MEDIUM)

**Our code (`claude-parser.ts:167`):** `evictOlderThan(sinceDateMs)` evicts cache entries by file mtime. If caller passes today's date as `sinceDate` (daily view), entries for files not modified today are evicted, even if those files contain sessions from this week needed for the weekly view. The next weekly query must re-parse those files.

**CodexBar:** Cache entries are retained by file path, not evicted by mtime. Stale files (deleted from disk) are cleaned up, but entries for old-but-still-present files are kept.

**Impact:** Unnecessary re-parsing when switching between daily/weekly/monthly views.

### Gap 5: Fast ASCII Pre-filter (LOW)

**CodexBar:** Before JSON-parsing each line, does a fast ASCII substring check for `"type":"assistant"` and `"usage"` (Claude) or `"type":"event_msg"` (Codex). Lines without these substrings are skipped without touching the JSON parser.

**Our code:** Every non-blank line goes through `JSON.parse()`, then we check `event.type !== "assistant"` after parsing.

**Impact:** Performance only. JSON.parse is already fast in Bun, but pre-filtering could skip 60-80% of lines (tool_use, user, system events).

### Gap 6: Codex Token Field Separation (LOW)

**CodexBar:** Separates `input_tokens` and `cached_input_tokens` into distinct fields in the data model.

**Our code (`codex-parser.ts:97-98`):** Collapses `input_tokens + cached_input_tokens` into a single `inputTokens` field, and `cacheReadTokens` is hardcoded to 0.

**Impact:** Loss of cache hit/miss visibility for Codex. Minor for current dashboard, but limits future cost estimation.

---

## Gaps Where We Are Already Good

| Area | Status |
|------|--------|
| `isSidechain` filtering | Already implemented (line 65) |
| Parallel file parsing | Already implemented (`Promise.all`) |
| SQLite cache with mtime | Already implemented |
| Fallback chain (API > PTY > cache > zeros) | Already implemented, well-structured |
| Subscription plan detection | Multiple fallback regexes, comparable to CodexBar |

---

## Improvement Plan

### Phase 1: Fix Token Inflation (Critical, ~2 days)

**Goal:** Eliminate ~2x duplicate counting for Claude subagent sessions.

**Approach:** Port CodexBar's cross-file dedup concept to our TypeScript stack.

1. **Extend `ClaudeEvent` interface** in `claude-parser.ts` to extract `sessionId` (from file path, which encodes the session) and `messageId`/`requestId` from the event JSON
2. **Add dedup pass** after all files are parsed: build a `Map<canonicalKey, SessionTokens>` where `canonicalKey = sessionId:messageId:requestId`
3. **Winner selection:** When the same canonical key appears from multiple files, prefer the entry from a subagent path (path containing `/subagents/`) over a parent path
4. **Update tests** in `tests/core/claude-parser.test.ts` with fixtures that exercise the dedup path

**Files to modify:**
- `packages/core/src/parsers/claude-parser.ts` — add dedup pass after line 160
- `packages/core/src/parsers/types.ts` — optionally add `messageId`/`requestId` to intermediate type (not needed in final `SessionTokens`)
- `tests/core/claude-parser.test.ts` — add dedup test cases

### Phase 2: Codex Session Dedup + Archived Sessions (~1 day)

**Goal:** Prevent double-counting archived Codex sessions.

1. **Scan `archived_sessions/`** in addition to `sessions/`
2. **Extract `session_id`** from the `session_meta` line (already parsed at `codex-parser.ts:68`)
3. **Deduplicate** by `session_id` across all files, preferring the file with the latest mtime

**Files to modify:**
- `packages/core/src/parsers/codex-parser.ts` — add `archived_sessions/` scan + session_id dedup
- `tests/core/codex-parser.test.ts` — if exists, add dedup fixture

### Phase 3: Fix Cache Eviction Strategy (~0.5 day)

**Goal:** Stop evicting cache entries that are still useful for wider time windows.

1. **Replace `evictOlderThan(sinceDateMs)`** with a smarter eviction: only evict entries for files that no longer exist on disk
2. **Add a max-entries cap** (e.g., 10K entries) as a safety bound instead of date-based pruning

**Files to modify:**
- `packages/core/src/parsers/parse-cache.ts` — replace eviction logic
- `packages/core/src/parsers/claude-parser.ts` — update eviction call
- `packages/core/src/parsers/codex-parser.ts` — update eviction call

### Phase 4: Performance Wins (Optional, ~0.5 day)

**Goal:** Faster parsing for large session files.

1. **ASCII pre-filter:** Before `JSON.parse`, check if line contains `"assistant"` and `"usage"` (Claude) or `"token_count"` (Codex) as plain string substrings
2. **Incremental parsing:** Track `parsedBytes` in cache, seek to offset on re-parse. This is a larger change and may not be worth it given Bun's fast I/O.

**Files to modify:**
- `packages/core/src/parsers/claude-parser.ts` — add `line.includes()` checks before JSON.parse
- `packages/core/src/parsers/codex-parser.ts` — same

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Dedup key fields (`messageId`, `requestId`) may not exist in all JSONL formats | Fall back to per-file dedup only when keys missing |
| 2 | `archived_sessions/` layout may vary across Codex versions | Glob pattern handles both flat and dated layouts |
| 3 | Removing date-based eviction could grow cache unboundedly | Max-entries cap as safety net |
| 4 | Pre-filter false negatives (line contains substring but in wrong context) | Not possible: we check structure after JSON.parse anyway, pre-filter is additive |

## Sources

- CodexBar repo: https://github.com/steipete/CodexBar (cloned, depth 50)
- Commit `91146a2`: Cross-file dedup fix with `ClaudeUsageRow` and `claudeRowWins` selection
- Commit `0f7d071` + `9bb4174`: PTY drain hardening
- Our parsers: `packages/core/src/parsers/{claude-parser,codex-parser,parse-cache,aggregator,types}.ts`
