import { readFileSync } from "node:fs";
import { DEFAULT_DAEMON_PID_PATH, type MetricsDict, type ServiceName, UsageStore } from "@lazyusage/core";
import { type Accessor, createSignal } from "solid-js";

type DaemonDetectionStore = Pick<UsageStore, "isDaemonHeartbeatFresh" | "getLatestSnapshot" | "close">;

interface DaemonBackedServices {
  claude: boolean;
  codex: boolean;
}

export interface DaemonDetectionHook {
  daemonHealthy: Accessor<boolean>;
  daemonBackedServices: Accessor<DaemonBackedServices>;
  daemonMetrics: Accessor<Partial<Record<ServiceName, MetricsDict>>>;
  detect: () => void;
}

export interface DaemonDetectionOptions {
  pidFilePath?: string;
  readPidFile?: (path: string) => string;
  isProcessRunning?: (pid: number) => boolean;
  createStore?: () => DaemonDetectionStore;
}

function parsePid(pidContents: string): number | null {
  const pid = Number.parseInt(pidContents.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function createInactiveServices(): DaemonBackedServices {
  return {
    claude: false,
    codex: false,
  };
}

export function useDaemonDetection(options: DaemonDetectionOptions = {}): DaemonDetectionHook {
  const [daemonHealthy, setDaemonHealthy] = createSignal(false);
  const [daemonBackedServices, setDaemonBackedServices] = createSignal<DaemonBackedServices>(createInactiveServices());
  const [daemonMetrics, setDaemonMetrics] = createSignal<Partial<Record<ServiceName, MetricsDict>>>({});

  const pidFilePath = options.pidFilePath ?? DEFAULT_DAEMON_PID_PATH;
  const readPidFile = options.readPidFile ?? ((path: string) => readFileSync(path, "utf-8"));
  const isProcessRunning =
    options.isProcessRunning ??
    ((pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const createStore = options.createStore ?? (() => new UsageStore());

  function reset() {
    setDaemonHealthy(false);
    setDaemonBackedServices(createInactiveServices());
    setDaemonMetrics({});
  }

  function detect() {
    reset();

    let pidContents: string;
    try {
      pidContents = readPidFile(pidFilePath);
    } catch {
      return;
    }

    const pid = parsePid(pidContents);
    if (!pid || !isProcessRunning(pid)) {
      return;
    }

    const store = createStore();

    try {
      const nextBackedServices = createInactiveServices();
      const nextMetrics: Partial<Record<ServiceName, MetricsDict>> = {};

      for (const service of ["claude", "codex"] satisfies ServiceName[]) {
        if (!store.isDaemonHeartbeatFresh(service)) {
          continue;
        }

        const metrics = store.getLatestSnapshot(service);
        if (!metrics) {
          continue;
        }

        nextBackedServices[service] = true;
        nextMetrics[service] = metrics;
      }

      setDaemonBackedServices(nextBackedServices);
      setDaemonMetrics(nextMetrics);
      setDaemonHealthy(nextBackedServices.claude || nextBackedServices.codex);
    } finally {
      store.close();
    }
  }

  return {
    daemonHealthy,
    daemonBackedServices,
    daemonMetrics,
    detect,
  };
}
