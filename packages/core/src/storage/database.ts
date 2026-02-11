/**
 * Usage data storage using bun:sqlite.
 * Ported from Python src/storage/database.py
 */
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";
import { parseTimeToDatetime } from "../utils/time.js";
import type { HistoryEntry, MetricsDict, ServiceName } from "../types.js";

export class UsageStore {
  static readonly DEFAULT_DB_PATH = join(
    homedir(),
    ".local",
    "share",
    "usage-cli",
    "usage.db",
  );

  private db: Database;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ?? process.env.USAGE_CLI_DB_PATH ?? UsageStore.DEFAULT_DB_PATH;

    if (resolvedPath !== ":memory:") {
      const dir = dirname(resolvedPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(resolvedPath);
    this.initDatabase();
  }

  private initDatabase(): void {
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
    const hoursParam =
      hours === Math.floor(hours) ? Math.floor(hours) : hours;
    const rows = this.db
      .query(
        `SELECT timestamp, used_pct
         FROM usage_snapshots
         WHERE service = ?
           AND metric_name = ?
           AND timestamp >= datetime('now', '-' || ? || ' hours')
         ORDER BY timestamp ASC`,
      )
      .all(service, metricName, hoursParam) as Array<{
      timestamp: string;
      used_pct: number;
    }>;

    return rows.map((row) => ({
      timestamp: row.timestamp,
      used_pct: row.used_pct,
    }));
  }

  cleanupOldSnapshots(days: number = 30): number {
    const result = this.db.run(
      `DELETE FROM usage_snapshots WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [days],
    );
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
