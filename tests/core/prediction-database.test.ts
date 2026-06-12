import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { UsageStore } from "../../packages/core/src/storage/database.js";
import type { Regime } from "../../packages/core/src/types.js";

function getInternalDb(store: UsageStore): Database {
  return (store as unknown as { db: Database }).db;
}

describe("UsageStore prediction features", () => {
  let store: UsageStore;

  beforeEach(() => {
    store = new UsageStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  function insertSnapshot(
    service: string,
    metricName: string,
    usedPct: number,
    timestamp: string,
    resetsAt: string | null = null,
  ) {
    // Use the internal db to insert test data directly
    const db = getInternalDb(store);
    db.run(
      `INSERT INTO usage_snapshots (timestamp, service, metric_name, used_pct, remaining_pct, resets_at, source, collection_id)
       VALUES (?, ?, ?, ?, ?, ?, 'test', ?)`,
      [timestamp, service, metricName, usedPct, 100 - usedPct, resetsAt, crypto.randomUUID()],
    );
  }

  describe("getDailyBoundaries", () => {
    // getDailyBoundaries filters to the last N days relative to Date.now(),
    // so fixtures must use recent timestamps rather than fixed dates.
    function isoAt(daysAgo: number, hourUtc: number): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - daysAgo);
      d.setUTCHours(hourUtc, 0, 0, 0);
      return d.toISOString();
    }
    const dayOf = (iso: string) => iso.slice(0, 10);

    test("returns correct first/last per day", () => {
      insertSnapshot("claude", "week_all", 30, isoAt(5, 8));
      insertSnapshot("claude", "week_all", 35, isoAt(5, 12));
      insertSnapshot("claude", "week_all", 45, isoAt(5, 18));

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].date).toBe(dayOf(isoAt(5, 8)));
      expect(boundaries[0].firstUsedPct).toBe(30);
      expect(boundaries[0].lastUsedPct).toBe(45);
      expect(boundaries[0].sampleCount).toBe(3);
    });

    test("handles sparse data: only days with snapshots", () => {
      insertSnapshot("claude", "week_all", 30, isoAt(5, 8));
      insertSnapshot("claude", "week_all", 45, isoAt(5, 18));
      // No data 4 days ago
      insertSnapshot("claude", "week_all", 50, isoAt(3, 8));
      insertSnapshot("claude", "week_all", 55, isoAt(3, 18));

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries).toHaveLength(2);
      expect(boundaries[0].date).toBe(dayOf(isoAt(5, 8)));
      expect(boundaries[1].date).toBe(dayOf(isoAt(3, 8)));
    });

    test("filters by metric name", () => {
      insertSnapshot("claude", "week_all", 30, isoAt(5, 8));
      insertSnapshot("claude", "week_all", 45, isoAt(5, 18));
      insertSnapshot("claude", "week_sonnet", 20, isoAt(5, 8));
      insertSnapshot("claude", "week_sonnet", 25, isoAt(5, 18));

      const weekAll = store.getDailyBoundaries("claude", "week_all", 30);
      expect(weekAll).toHaveLength(1);
      expect(weekAll[0].firstUsedPct).toBe(30);

      const weekSonnet = store.getDailyBoundaries("claude", "week_sonnet", 30);
      expect(weekSonnet).toHaveLength(1);
      expect(weekSonnet[0].firstUsedPct).toBe(20);
    });

    test("includes resets_at from last snapshot", () => {
      const resetsAt = isoAt(5, 14);
      insertSnapshot("claude", "week_all", 80, isoAt(5, 8));
      insertSnapshot("claude", "week_all", 16, isoAt(5, 18), resetsAt);

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries[0].resetsAt).toBe(resetsAt);
    });

    test("empty database returns empty array", () => {
      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries).toEqual([]);
    });
  });

  describe("capacity marks CRUD", () => {
    test("set and get marks", () => {
      store.setCapacityMark("2026-03-26", "H" as Regime);
      store.setCapacityMark("2026-03-27", "L" as Regime);

      const marks = store.getCapacityMarks();
      expect(marks).toHaveLength(2);
      expect(marks[0]).toEqual({ date: "2026-03-26", regime: "H" });
      expect(marks[1]).toEqual({ date: "2026-03-27", regime: "L" });
    });

    test("upsert: setting same date replaces regime", () => {
      store.setCapacityMark("2026-03-26", "H" as Regime);
      store.setCapacityMark("2026-03-26", "L" as Regime);

      const marks = store.getCapacityMarks();
      expect(marks).toHaveLength(1);
      expect(marks[0].regime).toBe("L");
    });

    test("clear single mark", () => {
      store.setCapacityMark("2026-03-26", "H" as Regime);
      store.setCapacityMark("2026-03-27", "L" as Regime);
      store.clearCapacityMark("2026-03-26");

      const marks = store.getCapacityMarks();
      expect(marks).toHaveLength(1);
      expect(marks[0].date).toBe("2026-03-27");
    });

    test("clear all marks", () => {
      store.setCapacityMark("2026-03-26", "H" as Regime);
      store.setCapacityMark("2026-03-27", "L" as Regime);
      store.clearAllCapacityMarks();

      const marks = store.getCapacityMarks();
      expect(marks).toHaveLength(0);
    });

    test("old marks cleaned up by cleanupOldSnapshots", () => {
      // Insert a mark for 10 days ago (should be cleaned up)
      const oldDate = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
      store.setCapacityMark(oldDate, "H" as Regime);

      // Insert a mark for tomorrow (should remain)
      const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
      store.setCapacityMark(tomorrow, "L" as Regime);

      store.cleanupOldSnapshots(30);

      const marks = store.getCapacityMarks();
      expect(marks).toHaveLength(1);
      expect(marks[0].date).toBe(tomorrow);
    });

    test("regime CHECK constraint rejects invalid values", () => {
      expect(() => {
        getInternalDb(store).run(`INSERT INTO capacity_marks (date, regime) VALUES (?, ?)`, ["2026-03-26", "X"]);
      }).toThrow();
    });
  });
});
