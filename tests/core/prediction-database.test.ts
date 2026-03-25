import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { UsageStore } from "../../packages/core/src/storage/database.js";
import type { Regime } from "../../packages/core/src/types.js";

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
    const db = (store as any).db;
    db.run(
      `INSERT INTO usage_snapshots (timestamp, service, metric_name, used_pct, remaining_pct, resets_at, source, collection_id)
       VALUES (?, ?, ?, ?, ?, ?, 'test', ?)`,
      [timestamp, service, metricName, usedPct, 100 - usedPct, resetsAt, crypto.randomUUID()],
    );
  }

  describe("getDailyBoundaries", () => {
    test("returns correct first/last per day", () => {
      insertSnapshot("claude", "week_all", 30, "2026-03-20T08:00:00Z");
      insertSnapshot("claude", "week_all", 35, "2026-03-20T12:00:00Z");
      insertSnapshot("claude", "week_all", 45, "2026-03-20T18:00:00Z");

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0].date).toBe("2026-03-20");
      expect(boundaries[0].firstUsedPct).toBe(30);
      expect(boundaries[0].lastUsedPct).toBe(45);
      expect(boundaries[0].sampleCount).toBe(3);
    });

    test("handles sparse data: only days with snapshots", () => {
      insertSnapshot("claude", "week_all", 30, "2026-03-20T08:00:00Z");
      insertSnapshot("claude", "week_all", 45, "2026-03-20T18:00:00Z");
      // No data for 2026-03-21
      insertSnapshot("claude", "week_all", 50, "2026-03-22T08:00:00Z");
      insertSnapshot("claude", "week_all", 55, "2026-03-22T18:00:00Z");

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries).toHaveLength(2);
      expect(boundaries[0].date).toBe("2026-03-20");
      expect(boundaries[1].date).toBe("2026-03-22");
    });

    test("filters by metric name", () => {
      insertSnapshot("claude", "week_all", 30, "2026-03-20T08:00:00Z");
      insertSnapshot("claude", "week_all", 45, "2026-03-20T18:00:00Z");
      insertSnapshot("claude", "week_sonnet", 20, "2026-03-20T08:00:00Z");
      insertSnapshot("claude", "week_sonnet", 25, "2026-03-20T18:00:00Z");

      const weekAll = store.getDailyBoundaries("claude", "week_all", 30);
      expect(weekAll).toHaveLength(1);
      expect(weekAll[0].firstUsedPct).toBe(30);

      const weekSonnet = store.getDailyBoundaries("claude", "week_sonnet", 30);
      expect(weekSonnet).toHaveLength(1);
      expect(weekSonnet[0].firstUsedPct).toBe(20);
    });

    test("includes resets_at from last snapshot", () => {
      insertSnapshot("claude", "week_all", 80, "2026-03-20T08:00:00Z");
      insertSnapshot("claude", "week_all", 16, "2026-03-20T18:00:00Z", "2026-03-20T14:00:00Z");

      const boundaries = store.getDailyBoundaries("claude", "week_all", 30);
      expect(boundaries[0].resetsAt).toBe("2026-03-20T14:00:00Z");
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
        (store as any).db.run(
          `INSERT INTO capacity_marks (date, regime) VALUES (?, ?)`,
          ["2026-03-26", "X"],
        );
      }).toThrow();
    });
  });
});
