import { DedupTracker } from "../storage/dedup.js";
import type { UsageStore } from "../storage/database.js";
import type { FetchResult, MetricsDict, ServiceName } from "../types.js";
import type { DaemonLogger } from "./logger.js";

export interface DaemonCollectorChain {
  refresh(): Promise<FetchResult>;
}

export interface DaemonCollector {
  collectOnce(): Promise<void>;
}

export interface DaemonCollectorOptions {
  services: Partial<Record<ServiceName, DaemonCollectorChain>>;
  store: Pick<UsageStore, "storeSnapshot" | "recordDaemonHeartbeat">;
  logger: Pick<DaemonLogger, "warn">;
  dedup?: Pick<DedupTracker, "shouldStoreMetrics">;
  now?: () => Date;
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

  return {
    async collectOnce(): Promise<void> {
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
}
