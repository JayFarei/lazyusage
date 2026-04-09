/**
 * Usage data storage using bun:sqlite.
 * Ported from Python src/storage/database.py
 */
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, existsSync, chmodSync } from "fs";
import { parseTimeToDatetime } from "../utils/time.js";
import type { HistoryEntry, MetricsDict, ServiceName, DailyBoundary, SupervisedMark, Regime } from "../types.js";

type DaemonService = ServiceName | "_daemon";

interface DaemonStatusRow {
  service: DaemonService;
  lastCollectedAt: string | null;
  lastSource: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string;
}

interface DaemonHeartbeatInput {
  collectedAt?: string | null;
  source?: string | null;
  error?: string | null;
  pid?: number | null;
  startedAt?: string | null;
}

export class UsageStore {
  static readonly DEFAULT_DB_PATH = join(
    homedir(),
    ".local",
    "share",
    "lazyusage",
    "usage.db",
  );

  private db: Database;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? process.env.LAZYUSAGE_DB_PATH ?? UsageStore.DEFAULT_DB_PATH;

    if (resolvedPath !== ":memory:") {
      const dir = dirname(resolvedPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(resolvedPath);
    if (resolvedPath !== ":memory:") {
      try { chmodSync(resolvedPath, 0o600); } catch { /* may not exist yet */ }
    }
    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        service TEXT NOT NULL CHECK (service IN ('claude', 'codex')),
        metric_name TEXT NOT NULL,
        used_pct INTEGER NOT NULL,
        remaining_pct INTEGER NOT NULL,
        resets TEXT,
        resets_at TEXT,
        subscription_type TEXT,
        source TEXT NOT NULL DEFAULT 'pty',
        collection_id TEXT
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_snapshots_service_metric_ts ON usage_snapshots (service, metric_name, timestamp)`,
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON usage_snapshots (timestamp)`,
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS capacity_marks (
        date TEXT PRIMARY KEY,
        regime TEXT NOT NULL CHECK (regime IN ('L', 'M', 'H', 'B')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS daemon_status (
        service TEXT PRIMARY KEY,
        last_collected_at TEXT,
        last_source TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        pid INTEGER,
        started_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
  }

  storeSnapshot(
    service: ServiceName,
    metrics: MetricsDict,
    source: string,
    collectionId?: string,
  ): void {
    if (!metrics || Object.keys(metrics).length === 0) return;

    const id = collectionId ?? crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const subscriptionType =
      (metrics.subscription_type as string | null) ?? null;

    const stmt = this.db.prepare(`
      INSERT INTO usage_snapshots
        (timestamp, service, metric_name, used_pct, remaining_pct, resets, resets_at, subscription_type, source, collection_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const [metricName, metricData] of Object.entries(metrics)) {
        if (
          metricName === "subscription_type" ||
          typeof metricData !== "object" ||
          metricData === null
        ) {
          continue;
        }
        const usedPct = metricData.used_pct ?? 0;
        const remainingPct = metricData.remaining_pct ?? 0;
        const resets = metricData.resets ?? null;

        let resetsAt: string | null = null;
        if (resets) {
          try {
            const dt = parseTimeToDatetime(resets);
            resetsAt = dt.toISOString();
          } catch {
            // ignore parse errors
          }
        }

        stmt.run(
          timestamp,
          service,
          metricName,
          usedPct,
          remainingPct,
          resets,
          resetsAt,
          subscriptionType,
          source,
          id,
        );
      }
    });

    transaction();
  }

  getLatestSnapshot(service: ServiceName): MetricsDict | null {
    const rows = this.db
      .query(
        `SELECT metric_name, used_pct, remaining_pct, resets, subscription_type
         FROM usage_snapshots
         WHERE service = ?
           AND collection_id = (
             SELECT collection_id FROM usage_snapshots
             WHERE service = ?
             ORDER BY timestamp DESC, id DESC LIMIT 1
           )`,
      )
      .all(service, service) as Array<{
      metric_name: string;
      used_pct: number;
      remaining_pct: number;
      resets: string | null;
      subscription_type: string | null;
    }>;

    if (rows.length === 0) return null;

    const metrics: MetricsDict = {};
    let subscriptionType: string | null = null;

    for (const row of rows) {
      metrics[row.metric_name] = {
        used_pct: row.used_pct,
        remaining_pct: row.remaining_pct,
        resets: row.resets ?? "",
      };
      if (row.subscription_type) {
        subscriptionType = row.subscription_type;
      }
    }

    if (subscriptionType) {
      metrics.subscription_type = subscriptionType;
    }

    return metrics;
  }

  getHistory(
    service: ServiceName,
    metricName: string,
    hours: number = 1,
  ): HistoryEntry[] {
    const cutoffIso = new Date(Date.now() - hours * 3600_000).toISOString();
    const rows = this.db
      .query(
        `SELECT timestamp, used_pct
         FROM usage_snapshots
         WHERE service = ?
           AND metric_name = ?
           AND timestamp >= ?
         ORDER BY timestamp ASC`,
      )
      .all(service, metricName, cutoffIso) as Array<{
      timestamp: string;
      used_pct: number;
    }>;

    return rows.map((row) => ({
      timestamp: row.timestamp,
      used_pct: row.used_pct,
    }));
  }

  cleanupOldSnapshots(days: number = 30): number {
    const cutoffIso = new Date(Date.now() - days * 86400_000).toISOString();
    const result = this.db.run(
      `DELETE FROM usage_snapshots WHERE timestamp < ?`,
      [cutoffIso],
    );
    const markCutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    this.db.run(`DELETE FROM capacity_marks WHERE date < ?`, [markCutoff]);
    return result.changes;
  }

  getDailyBoundaries(
    service: ServiceName,
    metricName: string,
    days: number = 30,
  ): DailyBoundary[] {
    const cutoffIso = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = this.db
      .query(
        `SELECT
          date(timestamp) AS day,
          MIN(used_pct) AS min_pct,
          MAX(used_pct) AS max_pct,
          COUNT(*) AS sample_count,
          (SELECT s2.used_pct FROM usage_snapshots s2
           WHERE s2.service = ? AND s2.metric_name = ?
             AND date(s2.timestamp) = date(s1.timestamp)
           ORDER BY s2.timestamp ASC LIMIT 1) AS first_pct,
          (SELECT s2.used_pct FROM usage_snapshots s2
           WHERE s2.service = ? AND s2.metric_name = ?
             AND date(s2.timestamp) = date(s1.timestamp)
           ORDER BY s2.timestamp DESC LIMIT 1) AS last_pct,
          (SELECT s2.resets_at FROM usage_snapshots s2
           WHERE s2.service = ? AND s2.metric_name = ?
             AND date(s2.timestamp) = date(s1.timestamp)
           ORDER BY s2.timestamp DESC LIMIT 1) AS resets_at
        FROM usage_snapshots s1
        WHERE service = ? AND metric_name = ? AND timestamp >= ?
        GROUP BY date(timestamp)
        ORDER BY day`,
      )
      .all(service, metricName, service, metricName, service, metricName, service, metricName, cutoffIso) as Array<{
      day: string;
      sample_count: number;
      first_pct: number;
      last_pct: number;
      resets_at: string | null;
    }>;

    return rows.map((row) => ({
      date: row.day,
      firstUsedPct: row.first_pct,
      lastUsedPct: row.last_pct,
      resetsAt: row.resets_at,
      sampleCount: row.sample_count,
    }));
  }

  setCapacityMark(date: string, regime: Regime): void {
    this.db.run(
      `INSERT OR REPLACE INTO capacity_marks (date, regime) VALUES (?, ?)`,
      [date, regime],
    );
  }

  getCapacityMarks(): SupervisedMark[] {
    const rows = this.db
      .query(`SELECT date, regime FROM capacity_marks ORDER BY date`)
      .all() as Array<{ date: string; regime: Regime }>;
    return rows;
  }

  clearCapacityMark(date: string): void {
    this.db.run(`DELETE FROM capacity_marks WHERE date = ?`, [date]);
  }

  clearAllCapacityMarks(): void {
    this.db.run(`DELETE FROM capacity_marks`);
  }

  recordDaemonHeartbeat(service: DaemonService, input: DaemonHeartbeatInput): void {
    const existing = this.getDaemonStatus(service);
    const nowIso = new Date().toISOString();
    const hasError = typeof input.error === "string" && input.error.length > 0;

    const next: DaemonStatusRow = {
      service,
      lastCollectedAt: hasError
        ? existing?.lastCollectedAt ?? null
        : input.collectedAt ?? nowIso,
      lastSource: input.source ?? existing?.lastSource ?? null,
      lastError: hasError ? input.error! : null,
      consecutiveFailures: hasError
        ? (existing?.consecutiveFailures ?? 0) + 1
        : 0,
      pid: input.pid ?? existing?.pid ?? null,
      startedAt: input.startedAt ?? existing?.startedAt ?? null,
      updatedAt: nowIso,
    };

    this.db.run(
      `INSERT INTO daemon_status
        (service, last_collected_at, last_source, last_error, consecutive_failures, pid, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service) DO UPDATE SET
         last_collected_at = excluded.last_collected_at,
         last_source = excluded.last_source,
         last_error = excluded.last_error,
         consecutive_failures = excluded.consecutive_failures,
         pid = excluded.pid,
         started_at = excluded.started_at,
         updated_at = excluded.updated_at`,
      [
        next.service,
        next.lastCollectedAt,
        next.lastSource,
        next.lastError,
        next.consecutiveFailures,
        next.pid,
        next.startedAt,
        next.updatedAt,
      ],
    );
  }

  getDaemonStatus(service: DaemonService): DaemonStatusRow | null {
    const row = this.db
      .query(
        `SELECT
          service,
          last_collected_at,
          last_source,
          last_error,
          consecutive_failures,
          pid,
          started_at,
          updated_at
         FROM daemon_status
         WHERE service = ?`,
      )
      .get(service) as
      | {
          service: DaemonService;
          last_collected_at: string | null;
          last_source: string | null;
          last_error: string | null;
          consecutive_failures: number;
          pid: number | null;
          started_at: string | null;
          updated_at: string;
        }
      | null;

    if (!row) return null;

    return {
      service: row.service,
      lastCollectedAt: row.last_collected_at,
      lastSource: row.last_source,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      pid: row.pid,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    };
  }

  isDaemonHeartbeatFresh(
    service: DaemonService,
    maxAgeMs: number = 120_000,
  ): boolean {
    const status = this.getDaemonStatus(service);
    if (!status?.lastCollectedAt) return false;

    const collectedAtMs = Date.parse(status.lastCollectedAt);
    if (Number.isNaN(collectedAtMs)) return false;

    return Date.now() - collectedAtMs <= maxAgeMs;
  }

  close(): void {
    this.db.close();
  }
}
