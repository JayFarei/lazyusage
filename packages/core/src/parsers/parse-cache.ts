/**
 * Persistent parse cache for JSONL session files.
 *
 * Stores parsed SessionTokens keyed by (file_path, mtime_ms).
 * When a file's mtime is unchanged the cached result is returned without
 * re-reading or re-parsing the file. Files that are modified (new events
 * appended) are re-parsed and the cache entry is updated.
 *
 * Location: ~/.cache/lazyusage/parse-cache.db
 * Engine: bun:sqlite (same as UsageStore)
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import type { SessionTokens } from "./types.js";

const CACHE_DB_PATH =
  process.env.LAZYUSAGE_PARSE_CACHE_PATH ??
  join(homedir(), ".cache", "lazyusage", "parse-cache.db");

// Bump this when SessionTokens shape changes to force a full re-parse.
const SCHEMA_VERSION = 2;

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;
  mkdirSync(dirname(CACHE_DB_PATH), { recursive: true });
  const db = new Database(CACHE_DB_PATH, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS parse_cache (
      file_path   TEXT    PRIMARY KEY,
      mtime_ms    INTEGER NOT NULL,
      sessions_json TEXT  NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mtime ON parse_cache (mtime_ms);
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous  = NORMAL;
  `);

  // Clear all cached entries if the schema version has changed.
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | null;
  if (!row || parseInt(row.value, 10) !== SCHEMA_VERSION) {
    db.run("DELETE FROM parse_cache");
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
  }

  _db = db;
  return db;
}

export interface CacheEntry {
  mtimeMs: number;
  sessions: SessionTokens[];
}

/**
 * Load all cache entries with mtime >= sinceDateMs in one bulk SELECT.
 * Returns a Map<filePath, CacheEntry> for O(1) lookup.
 */
export function loadCacheSince(sinceDateMs: number): Map<string, CacheEntry> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT file_path, mtime_ms, sessions_json FROM parse_cache WHERE mtime_ms >= ?"
    )
    .all(sinceDateMs) as Array<{
    file_path: string;
    mtime_ms: number;
    sessions_json: string;
  }>;

  const map = new Map<string, CacheEntry>();
  for (const row of rows) {
    try {
      map.set(row.file_path, {
        mtimeMs: row.mtime_ms,
        sessions: JSON.parse(row.sessions_json) as SessionTokens[],
      });
    } catch {
      // Corrupt entry — will be re-parsed
    }
  }
  return map;
}

/**
 * Persist a batch of new/updated cache entries inside a single transaction.
 */
export function putCacheBatch(
  entries: Array<{ filePath: string; mtimeMs: number; sessions: SessionTokens[] }>
): void {
  if (entries.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO parse_cache (file_path, mtime_ms, sessions_json) VALUES (?, ?, ?)"
  );
  db.transaction(() => {
    for (const { filePath, mtimeMs, sessions } of entries) {
      stmt.run(filePath, mtimeMs, JSON.stringify(sessions));
    }
  })();
}

/**
 * Remove entries older than cutoffMs. Call occasionally to bound cache size.
 * @deprecated Use evictStale() instead, which avoids over-evicting entries
 * needed by wider time windows (e.g., weekly view after daily view).
 */
export function evictOlderThan(cutoffMs: number): void {
  getDb().run("DELETE FROM parse_cache WHERE mtime_ms < ?", [cutoffMs]);
}

/** Maximum number of cache entries to retain. */
const MAX_CACHE_ENTRIES = 10_000;

/**
 * Remove cache entries for files that no longer exist on disk,
 * then enforce a max-entries cap (oldest mtime first) as a safety bound.
 * This avoids the problem where date-based eviction nukes entries still
 * needed for wider time windows (e.g., weekly view after a daily query).
 */
export function evictStale(existingFiles: string[]): void {
  const db = getDb();
  const existingSet = new Set(existingFiles);

  // Get all cached file paths
  const rows = db
    .prepare("SELECT file_path FROM parse_cache")
    .all() as Array<{ file_path: string }>;

  const toDelete = rows
    .map((r) => r.file_path)
    .filter((p) => !existingSet.has(p));

  if (toDelete.length > 0) {
    const stmt = db.prepare("DELETE FROM parse_cache WHERE file_path = ?");
    db.transaction(() => {
      for (const p of toDelete) stmt.run(p);
    })();
  }

  // Enforce max entries cap
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM parse_cache").get() as { cnt: number };
  if (countRow.cnt > MAX_CACHE_ENTRIES) {
    const excess = countRow.cnt - MAX_CACHE_ENTRIES;
    db.run(
      "DELETE FROM parse_cache WHERE file_path IN (SELECT file_path FROM parse_cache ORDER BY mtime_ms ASC LIMIT ?)",
      [excess]
    );
  }
}
