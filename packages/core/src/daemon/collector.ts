import { DedupTracker } from "../storage/dedup.js";
import type { UsageStore } from "../storage/database.js";
import type { FetchResult, MetricsDict, ServiceName } from "../types.js";
import type { DaemonLogger } from "./logger.js";

export interface DaemonCollectorChain {
  refresh(): Promise<FetchResult>;
}

export interface DaemonCollectorStandby {
  windup(): Promise<void>;
  winddown(): Promise<void>;
}

export interface DaemonCollector {
  collectOnce(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type DaemonCollectorTimer = ReturnType<typeof globalThis.setInterval>;

export interface DaemonCollectorOptions {
  services: Partial<Record<ServiceName, DaemonCollectorChain>>;
  standbys?: Partial<Record<ServiceName, DaemonCollectorStandby>>;
  store: Pick<UsageStore, "storeSnapshot" | "recordDaemonHeartbeat">;
  logger: Pick<DaemonLogger, "warn">;
  dedup?: Pick<DedupTracker, "shouldStoreMetrics">;
  now?: () => Date;
  intervalSeconds?: number;
  ptyRecycleHours?: number;
  setInterval?: (
    callback: () => Promise<void>,
    intervalMs: number,
  ) => DaemonCollectorTimer;
  clearInterval?: (timer: DaemonCollectorTimer) => void;
}

function isSuccessfulResult(result: FetchResult): result is FetchResult & { metrics: MetricsDict } {
  return result.metrics !== null && result.error === null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function createDaemonCollector(
  options: DaemonCollectorOptions,
): DaemonCollector {
  const dedup = options.dedup ?? new DedupTracker();
  const now = options.now ?? (() => new Date());
  const intervalSeconds = options.intervalSeconds ?? 60;
  const standbys = options.standbys ?? {};
  const ptyRecycleMs = (options.ptyRecycleHours ?? 4) * 60 * 60 * 1000;
  const setIntervalFn = options.setInterval ?? ((callback, intervalMs) =>
    globalThis.setInterval(() => {
      void callback();
    }, intervalMs));
  const clearIntervalFn = options.clearInterval ?? ((timer) =>
    globalThis.clearInterval(timer));
  let timer: DaemonCollectorTimer | null = null;
  let running = false;
  let lastStandbyRecycleAt: number | null = null;

  const runStandbyAction = async (
    action: "windup" | "winddown",
    phase: "start" | "recycle" | "stop",
  ): Promise<void> => {
    for (const [service, standby] of Object.entries(standbys) as Array<
      [ServiceName, DaemonCollectorStandby | undefined]
    >) {
      if (!standby) continue;

      try {
        await standby[action]();
      } catch (error) {
        options.logger.warn(
          `[${service}] standby ${phase} failed: ${formatError(error)}`,
        );
      }
    }
  };

  const recycleStandbysIfDue = async (): Promise<void> => {
    if (lastStandbyRecycleAt === null || ptyRecycleMs <= 0) {
      return;
    }

    const currentTime = now().getTime();
    if (currentTime - lastStandbyRecycleAt < ptyRecycleMs) {
      return;
    }

    await runStandbyAction("winddown", "recycle");
    await runStandbyAction("windup", "recycle");
    lastStandbyRecycleAt = currentTime;
  };

  const runCycle = async (): Promise<void> => {
    if (!running) {
      return;
    }

    try {
      await collector.collectOnce();
    } catch (error) {
      options.logger.warn(`[collector] cycle failed: ${formatError(error)}`);
    }
  };

  const collector: DaemonCollector = {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      running = true;
      await runStandbyAction("windup", "start");
      lastStandbyRecycleAt = now().getTime();
      await runCycle();
      timer = setIntervalFn(runCycle, intervalSeconds * 1000);
    },

    async stop(): Promise<void> {
      running = false;

      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }

      await runStandbyAction("winddown", "stop");
      lastStandbyRecycleAt = null;
    },

    async collectOnce(): Promise<void> {
      await recycleStandbysIfDue();

      for (const [service, chain] of Object.entries(options.services) as Array<
        [ServiceName, DaemonCollectorChain | undefined]
      >) {
        if (!chain) continue;

        try {
          const result = await chain.refresh();
          if (!isSuccessfulResult(result)) {
            const error = result.error ?? "collection failed";
            options.store.recordDaemonHeartbeat(service, { error });
            options.logger.warn(`[${service}] collection failed: ${error}`);
            continue;
          }

          if (dedup.shouldStoreMetrics(service, result.metrics)) {
            options.store.storeSnapshot(service, result.metrics, result.source);
          }

          options.store.recordDaemonHeartbeat(service, {
            collectedAt: now().toISOString(),
            source: result.source,
          });
        } catch (error) {
          const message = formatError(error);
          options.store.recordDaemonHeartbeat(service, { error: message });
          options.logger.warn(`[${service}] collection failed: ${message}`);
        }
      }
    },
  };

  return collector;
}
