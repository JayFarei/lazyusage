/**
 * Tests for useAutoRefresh hook.
 * Uses createRoot for SolidJS context and fake timers for timer control.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createRoot } from "solid-js";

// Note: bun:test doesn't have jest.useFakeTimers, we use setInterval spying
// and verify behavior through signal state changes instead.

describe("useAutoRefresh - initial state", () => {
  test("starts enabled by default", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const cb = mock(() => {});
      const ar = useAutoRefresh(cb, 10);
      expect(ar.enabled()).toBe(true);
      expect(ar.interval()).toBe(10);
      ar.startTimer(); // start so cleanup happens
      dispose();
    });
  });

  test("clamps initial interval to minimum 5", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 2);
      expect(ar.interval()).toBe(5);
      dispose();
    });
  });
});

describe("useAutoRefresh - togglePause", () => {
  test("togglePause disables refresh", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 10);
      expect(ar.enabled()).toBe(true);
      ar.togglePause();
      expect(ar.enabled()).toBe(false);
      dispose();
    });
  });

  test("togglePause re-enables refresh", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 10);
      ar.togglePause(); // disable
      ar.togglePause(); // re-enable
      expect(ar.enabled()).toBe(true);
      dispose();
    });
  });
});

describe("useAutoRefresh - speedUp / slowDown", () => {
  test("speedUp decreases interval by 5", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 20);
      ar.speedUp();
      expect(ar.interval()).toBe(15);
      dispose();
    });
  });

  test("speedUp clamps at minimum 5", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 5);
      ar.speedUp();
      expect(ar.interval()).toBe(5);
      dispose();
    });
  });

  test("slowDown increases interval by 5", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 10);
      ar.slowDown();
      expect(ar.interval()).toBe(15);
      dispose();
    });
  });

  test("slowDown clamps at maximum 60", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 60);
      ar.slowDown();
      expect(ar.interval()).toBe(60);
      dispose();
    });
  });

  test("multiple speedUp calls decrement correctly", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 30);
      ar.speedUp();
      ar.speedUp();
      ar.speedUp();
      expect(ar.interval()).toBe(15);
      dispose();
    });
  });

  test("multiple slowDown calls increment correctly", async () => {
    const { useAutoRefresh } = await import("../../../packages/cli/src/tui/hooks/useAutoRefresh.js");
    createRoot((dispose) => {
      const ar = useAutoRefresh(() => {}, 10);
      ar.slowDown();
      ar.slowDown();
      ar.slowDown();
      expect(ar.interval()).toBe(25);
      dispose();
    });
  });
});
