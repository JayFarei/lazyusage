import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { UsageStore } from "../../packages/core/src/storage/database.js";

describe("UsageStore", () => {
  let store: UsageStore;
  const realDateNow = Date.now;

  beforeEach(() => {
    store = new UsageStore(":memory:");
  });

  afterEach(() => {
    Date.now = realDateNow;
    store.close();
  });

  describe("storeSnapshot and getLatestSnapshot", () => {
    test("stores and retrieves a snapshot", () => {
      const metrics = {
        session: { used_pct: 25, remaining_pct: 75, resets: "3:00pm" },
        weekly: { used_pct: 10, remaining_pct: 90, resets: "Feb 15 at 8:00am" },
        subscription_type: "pro",
      };

      store.storeSnapshot("claude", metrics, "pty");
      const result = store.getLatestSnapshot("claude");

      expect(result).not.toBeNull();
      expect(result!.subscription_type).toBe("pro");

      const session = result!.session;
      expect(typeof session).toBe("object");
      expect((session as any).used_pct).toBe(25);
      expect((session as any).remaining_pct).toBe(75);
      expect((session as any).resets).toBe("3:00pm");

      const weekly = result!.weekly;
      expect(typeof weekly).toBe("object");
      expect((weekly as any).used_pct).toBe(10);
    });

    test("returns null when no snapshots exist", () => {
      const result = store.getLatestSnapshot("claude");
      expect(result).toBeNull();
    });

    test("skips empty metrics", () => {
      store.storeSnapshot("claude", {}, "pty");
      const result = store.getLatestSnapshot("claude");
      expect(result).toBeNull();
    });

    test("uses custom collection_id", () => {
      const metrics = {
        session: { used_pct: 50, remaining_pct: 50, resets: "4:00pm" },
      };
      store.storeSnapshot("claude", metrics, "pty", "custom-id");
      const result = store.getLatestSnapshot("claude");
      expect(result).not.toBeNull();
      expect((result!.session as any).used_pct).toBe(50);
    });

    test("returns latest collection, not older ones", () => {
      const older = {
        session: { used_pct: 10, remaining_pct: 90, resets: "1:00pm" },
      };
      store.storeSnapshot("claude", older, "pty", "old-id");

      const newer = {
        session: { used_pct: 80, remaining_pct: 20, resets: "5:00pm" },
      };
      store.storeSnapshot("claude", newer, "pty", "new-id");

      const result = store.getLatestSnapshot("claude");
      expect(result).not.toBeNull();
      expect((result!.session as any).used_pct).toBe(80);
    });

    test("separates services", () => {
      store.storeSnapshot(
        "claude",
        { session: { used_pct: 30, remaining_pct: 70, resets: "2:00pm" } },
        "pty",
      );
      store.storeSnapshot(
        "codex",
        { "5h": { used_pct: 60, remaining_pct: 40, resets: "6:00pm" } },
        "pty",
      );

      const claude = store.getLatestSnapshot("claude");
      expect(claude).not.toBeNull();
      expect((claude!.session as any).used_pct).toBe(30);

      const codex = store.getLatestSnapshot("codex");
      expect(codex).not.toBeNull();
      expect((codex!["5h"] as any).used_pct).toBe(60);
    });
  });

  describe("getHistory", () => {
    test("returns history entries", () => {
      store.storeSnapshot(
        "claude",
        { session: { used_pct: 10, remaining_pct: 90, resets: "3:00pm" } },
        "pty",
      );
      store.storeSnapshot(
        "claude",
        { session: { used_pct: 20, remaining_pct: 80, resets: "3:00pm" } },
        "pty",
      );

      const history = store.getHistory("claude", "session", 1);
      expect(history.length).toBe(2);
      expect(history[0].used_pct).toBe(10);
      expect(history[1].used_pct).toBe(20);
      expect(history[0].timestamp).toBeDefined();
    });

    test("returns empty array when no history", () => {
      const history = store.getHistory("claude", "session", 1);
      expect(history).toEqual([]);
    });

    test("filters by service and metric_name", () => {
      store.storeSnapshot(
        "claude",
        { session: { used_pct: 10, remaining_pct: 90, resets: "3:00pm" } },
        "pty",
      );
      store.storeSnapshot(
        "codex",
        { "5h": { used_pct: 50, remaining_pct: 50, resets: "4:00pm" } },
        "pty",
      );

      const history = store.getHistory("claude", "session", 24);
      expect(history.length).toBe(1);
      expect(history[0].used_pct).toBe(10);

      const codexHistory = store.getHistory("codex", "5h", 24);
      expect(codexHistory.length).toBe(1);
      expect(codexHistory[0].used_pct).toBe(50);
    });

    test("filters ISO timestamps correctly against a fixed cutoff", () => {
      Date.now = () => new Date("2026-02-19T00:00:00.000Z").getTime();
      const db = (store as any).db;

      db.run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, source, collection_id)
         VALUES (?, 'claude', 'session', 10, 90, '3:00pm', 'pty', 'iso-old')`,
        ["2026-02-18T01:00:00.000Z"],
      );
      db.run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, source, collection_id)
         VALUES (?, 'claude', 'session', 20, 80, '3:00pm', 'pty', 'iso-new')`,
        ["2026-02-18T23:30:00.000Z"],
      );

      const history = store.getHistory("claude", "session", 2);
      expect(history.map((h) => h.timestamp)).toEqual(["2026-02-18T23:30:00.000Z"]);
      expect(history[0].used_pct).toBe(20);
    });
  });

  describe("cleanupOldSnapshots", () => {
    test("returns 0 when nothing to delete", () => {
      const deleted = store.cleanupOldSnapshots(30);
      expect(deleted).toBe(0);
    });

    test("does not delete recent snapshots", () => {
      store.storeSnapshot(
        "claude",
        { session: { used_pct: 10, remaining_pct: 90, resets: "3:00pm" } },
        "pty",
      );

      const deleted = store.cleanupOldSnapshots(30);
      expect(deleted).toBe(0);

      const history = store.getHistory("claude", "session", 24);
      expect(history.length).toBe(1);
    });

    test("deletes snapshots older than cutoff with ISO timestamps", () => {
      Date.now = () => new Date("2026-02-19T00:00:00.000Z").getTime();
      const db = (store as any).db;

      db.run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, source, collection_id)
         VALUES (?, 'claude', 'session', 10, 90, '3:00pm', 'pty', 'old')`,
        ["2026-02-15T00:00:00.000Z"],
      );
      db.run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, source, collection_id)
         VALUES (?, 'claude', 'session', 20, 80, '3:00pm', 'pty', 'new')`,
        ["2026-02-18T23:30:00.000Z"],
      );

      const deleted = store.cleanupOldSnapshots(1);
      expect(deleted).toBe(1);

      const history = store.getHistory("claude", "session", 48);
      expect(history.map((h) => h.timestamp)).toEqual(["2026-02-18T23:30:00.000Z"]);
    });
  });
});
