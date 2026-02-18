import { describe, test, expect, beforeEach } from "bun:test";
import { DedupTracker } from "../../packages/core/src/storage/dedup.js";

describe("DedupTracker", () => {
  let tracker: DedupTracker;

  beforeEach(() => {
    tracker = new DedupTracker();
  });

  describe("shouldStore", () => {
    test("returns true for first occurrence", () => {
      expect(tracker.shouldStore("claude", "session", 25)).toBe(true);
    });

    test("returns false for duplicate value within interval", () => {
      tracker.shouldStore("claude", "session", 25);
      expect(tracker.shouldStore("claude", "session", 25)).toBe(false);
    });

    test("returns true when value changes", () => {
      tracker.shouldStore("claude", "session", 25);
      expect(tracker.shouldStore("claude", "session", 30)).toBe(true);
    });

    test("returns true after heartbeat interval", () => {
      tracker.shouldStore("claude", "session", 25);

      // Manually hack the stored timestamp to simulate 61 seconds ago
      const key = "claude:session";
      const map = (tracker as any).lastStored as Map<
        string,
        [number, number]
      >;
      const entry = map.get(key)!;
      map.set(key, [entry[0], entry[1] - 61]);

      expect(tracker.shouldStore("claude", "session", 25)).toBe(true);
    });

    test("tracks different services independently", () => {
      tracker.shouldStore("claude", "session", 25);
      expect(tracker.shouldStore("codex", "session", 25)).toBe(true);
    });

    test("tracks different metrics independently", () => {
      tracker.shouldStore("claude", "session", 25);
      expect(tracker.shouldStore("claude", "weekly", 25)).toBe(true);
    });
  });

  describe("shouldStoreMetrics", () => {
    test("returns true when any metric should be stored", () => {
      const metrics = {
        session: { used_pct: 25, remaining_pct: 75, resets: "3:00pm" },
        weekly: { used_pct: 10, remaining_pct: 90, resets: "Feb 15 at 8am" },
      };

      expect(tracker.shouldStoreMetrics("claude", metrics)).toBe(true);
    });

    test("returns false when all metrics are duplicates", () => {
      const metrics = {
        session: { used_pct: 25, remaining_pct: 75, resets: "3:00pm" },
        weekly: { used_pct: 10, remaining_pct: 90, resets: "Feb 15 at 8am" },
      };

      // First call registers "session" (short-circuits, "weekly" not registered)
      tracker.shouldStoreMetrics("claude", metrics);
      // Second call: "session" is duplicate -> false, "weekly" is first-time -> true
      // So we need a third call after all metrics have been registered
      tracker.shouldStoreMetrics("claude", metrics);
      // Now both are registered, third call should be false
      expect(tracker.shouldStoreMetrics("claude", metrics)).toBe(false);
    });

    test("returns true when one metric changes", () => {
      const metrics1 = {
        session: { used_pct: 25, remaining_pct: 75, resets: "3:00pm" },
        weekly: { used_pct: 10, remaining_pct: 90, resets: "Feb 15 at 8am" },
      };

      tracker.shouldStoreMetrics("claude", metrics1);

      const metrics2 = {
        session: { used_pct: 30, remaining_pct: 70, resets: "3:00pm" },
        weekly: { used_pct: 10, remaining_pct: 90, resets: "Feb 15 at 8am" },
      };

      expect(tracker.shouldStoreMetrics("claude", metrics2)).toBe(true);
    });

    test("skips subscription_type field", () => {
      const metrics = {
        subscription_type: "pro",
        session: { used_pct: 25, remaining_pct: 75, resets: "3:00pm" },
      };

      expect(tracker.shouldStoreMetrics("claude", metrics)).toBe(true);
    });
  });

  describe("clear", () => {
    test("clears all stored state", () => {
      tracker.shouldStore("claude", "session", 25);
      expect(tracker.shouldStore("claude", "session", 25)).toBe(false);

      tracker.clear();
      expect(tracker.shouldStore("claude", "session", 25)).toBe(true);
    });
  });
});
