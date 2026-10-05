/**
 * Root TUI application component.
 * One row per visible service: bars (left) + ledger stats (right).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useKeyboard } from "@opentui/solid";
import {
  type CapacityPrediction,
  createChain,
  DataSource,
  DedupTracker,
  type MetricsDict,
  type PersistentFallbackChain,
  SERVICE_NAMES,
  SERVICES,
  type ServiceName,
  UsageStore,
} from "lazyusage-core";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FullscreenGraphView } from "./components/FullscreenGraphView.js";
import { FullscreenMetricView } from "./components/FullscreenMetricView.js";
import { FullscreenStatsView } from "./components/FullscreenStatsView.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
import { METRIC_KEYS, ServicePanel } from "./components/ServicePanel.js";
import { StatsPanel } from "./components/StatsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAutoRefresh } from "./hooks/useAutoRefresh.js";
import { type DaemonDetectionHook, useDaemonDetection } from "./hooks/useDaemonDetection.js";
import { createKeybindingHandler, PANEL_KEYS } from "./hooks/useKeybindings.js";
import { useLedgerData } from "./hooks/useLedgerData.js";
import { useMetrics } from "./hooks/useMetrics.js";
import { usePrediction } from "./hooks/usePrediction.js";
import { usePanelState } from "./hooks/useViewMode.js";
import { useTheme } from "./theme.js";

export interface AppProps {
  /** Services to show, in display order; takes precedence over `service` */
  services?: readonly ServiceName[];
  /** Single-service filter; "all" or undefined shows every service */
  service?: ServiceName | "all";
  deps?: Partial<AppDeps>;
}

type AppChain = Pick<PersistentFallbackChain, "start" | "refresh" | "stop">;
type AppStore = Pick<UsageStore, "cleanupOldSnapshots" | "storeSnapshot" | "close">;
type AppGraphStore = Pick<UsageStore, "getHistory" | "close">;
type AppDedupTracker = Pick<DedupTracker, "shouldStoreMetrics">;
type AppLedgerData = ReturnType<typeof useLedgerData>;
type AppAutoRefresh = ReturnType<typeof useAutoRefresh>;
type AppPrediction = ReturnType<typeof usePrediction>;

interface AppDeps {
  createDaemonDetection: () => DaemonDetectionHook;
  createLedgerData: typeof useLedgerData;
  createAutoRefresh: typeof useAutoRefresh;
  createPrediction: typeof usePrediction;
  createUsageStore: () => AppStore;
  createGraphStore: () => AppGraphStore;
  createDedupTracker: () => AppDedupTracker;
  createChain: (service: ServiceName, persistent: boolean) => AppChain;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
}

type StatsTab = "daily" | "weekly" | "monthly" | "graph";
const LEDGER_TABS = ["daily", "weekly", "monthly"] as const;

export function App(props: AppProps = {}) {
  const deps: AppDeps = {
    createDaemonDetection: props.deps?.createDaemonDetection ?? (() => useDaemonDetection()),
    createLedgerData: props.deps?.createLedgerData ?? useLedgerData,
    createAutoRefresh: props.deps?.createAutoRefresh ?? useAutoRefresh,
    createPrediction: props.deps?.createPrediction ?? usePrediction,
    createUsageStore: props.deps?.createUsageStore ?? (() => new UsageStore()),
    createGraphStore: props.deps?.createGraphStore ?? (() => new UsageStore()),
    createDedupTracker: props.deps?.createDedupTracker ?? (() => new DedupTracker()),
    createChain:
      props.deps?.createChain ??
      ((service: ServiceName, persistent: boolean) => createChain(service, persistent) as AppChain),
    setIntervalFn: props.deps?.setIntervalFn ?? setInterval,
    clearIntervalFn: props.deps?.clearIntervalFn ?? clearInterval,
  };

  const visibleServices: readonly ServiceName[] =
    props.services ?? (props.service && props.service !== "all" ? [props.service] : SERVICE_NAMES);
  const theme = useTheme();
  const { metricsFor, errorFor, dataSources, warnings, updateMetrics, checkWarning } = useMetrics();
  /** Metric keys the provider actually reported for a panel, so navigation skips absent bars (e.g. Codex 5h). */
  const presentMetricKeys = (panel: ServiceName): string[] | null => {
    const metrics = metricsFor(panel);
    if (!metrics) return null;
    return METRIC_KEYS[panel].filter((key) => {
      const val = metrics[key];
      return val !== null && typeof val === "object" && "used_pct" in val;
    });
  };
  const {
    activePanel,
    setActivePanel,
    focusStatsPanel,
    contentTab,
    setContentTab,
    selectedMetricIndex,
    selectedMetricKey,
    navigateMetric,
    focusedSide,
    fullscreenTarget,
    toggleFullscreen,
    exitFullscreen,
    switchFocusSide,
    sortState,
    cycleSortColumn,
    toggleSortDirection,
  } = usePanelState(presentMetricKeys);
  const [lastUpdated, setLastUpdated] = createSignal<string | null>(null);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [graphTabPanel, setGraphTabPanel] = createSignal<ServiceName | null>(null);
  const [currentTime, setCurrentTime] = createSignal(new Date().toLocaleTimeString());

  // Shared 30s tick for time-progress bars (replaces two per-panel setIntervals)
  const [tick, setTick] = createSignal(0);

  const ledger: AppLedgerData = deps.createLedgerData();
  const daemonDetection = deps.createDaemonDetection();

  // Prediction engine: runs on each tick, produces prediction data for weekly bars
  const { predictionFor }: AppPrediction = deps.createPrediction(tick, metricsFor, visibleServices);

  // Provider chains for services not backed by the daemon
  const chains = new Map<ServiceName, AppChain>();

  // Storage
  let store: AppStore | null = null;
  const dedup = deps.createDedupTracker();

  async function applyFetchResult(service: ServiceName, result: Awaited<ReturnType<AppChain["refresh"]>>) {
    const metrics = result.metrics as MetricsDict | null;
    const error = result.error;
    const source = result.source;
    updateMetrics(service, metrics, error, source);
    checkWarning(service, result);

    if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
      store.storeSnapshot(service, metrics, source);
    }
  }

  function handleRefreshError(service: ServiceName, err: unknown) {
    updateMetrics(service, null, String(err), DataSource.FALLBACK);
  }

  async function refreshTrackedChain(service: ServiceName, chain: AppChain) {
    try {
      const result = await chain.refresh();
      await applyFetchResult(service, result);
    } catch (err) {
      handleRefreshError(service, err);
    }
  }

  async function refreshDaemonBackedService(service: ServiceName) {
    const temporaryChain = deps.createChain(service, true);

    try {
      const result = await temporaryChain.start();
      await applyFetchResult(service, result);
    } catch (err) {
      handleRefreshError(service, err);
    } finally {
      await temporaryChain.stop().catch(() => {});
    }
  }

  async function refreshAll() {
    setLastUpdated(new Date().toLocaleTimeString());
    await Promise.all([
      ...[...chains].map(([service, chain]) => refreshTrackedChain(service, chain)),
      ledger.refresh(),
    ]);
  }

  async function refreshOnDemand() {
    setLastUpdated(new Date().toLocaleTimeString());

    const daemonBackedServices = daemonDetection.daemonBackedServices();

    await Promise.all([
      ...visibleServices.map((service) => {
        const chain = chains.get(service);
        if (chain) return refreshTrackedChain(service, chain);
        if (daemonBackedServices[service]) return refreshDaemonBackedService(service);
        return Promise.resolve();
      }),
      ledger.refresh(true),
    ]);
  }

  const autoRefresh: AppAutoRefresh = deps.createAutoRefresh(refreshAll, 10);

  const isServiceVisible = (panel: ServiceName) => visibleServices.includes(panel);
  const graphAvailableFor = (service: ServiceName) => daemonDetection.daemonBackedServices()[service];
  const selectedMetricKeyFor = (service: ServiceName) =>
    activePanel() === service ? selectedMetricKey() : (METRIC_KEYS[service][0] ?? selectedMetricKey());
  const graphPredictionFor = (service: ServiceName): Record<string, CapacityPrediction> | null =>
    predictionFor(service);

  const displayedStatsTab = (service: ServiceName): StatsTab =>
    graphTabPanel() === service && graphAvailableFor(service) ? "graph" : contentTab();

  const cycleStatsTab = (direction: "left" | "right") => {
    const service = activePanel();
    const tabs: StatsTab[] = graphAvailableFor(service) ? [...LEDGER_TABS, "graph"] : [...LEDGER_TABS];
    const current = displayedStatsTab(service);
    const currentIndex = tabs.indexOf(current);
    const nextTab =
      direction === "right"
        ? tabs[(currentIndex + 1) % tabs.length]
        : tabs[(currentIndex - 1 + tabs.length) % tabs.length];

    if (nextTab === "graph") {
      setGraphTabPanel(service);
      return;
    }

    setContentTab(nextTab);
    setGraphTabPanel((currentPanel) => (currentPanel === service ? null : currentPanel));
  };

  const setActivePanelIfVisible = (panel: ServiceName) => {
    if (!isServiceVisible(panel)) return;
    setActivePanel(panel);
  };

  const focusStatsIfVisible = (panel: ServiceName) => {
    if (!isServiceVisible(panel)) return;
    focusStatsPanel(panel);
  };

  // Keybindings
  const handleKey = createKeybindingHandler({
    setActivePanel: setActivePanelIfVisible,
    focusStatsPanel: focusStatsIfVisible,
    navigateMetric,
    cycleTab: cycleStatsTab,
    togglePause: autoRefresh.togglePause,
    triggerRefresh: () => {
      if (ledger.loading()) return;
      refreshOnDemand();
    },
    speedUp: autoRefresh.speedUp,
    slowDown: autoRefresh.slowDown,
    setHelpVisible,
    helpVisible,
    quit: () => {
      cleanup();
      process.exit(0);
    },
    switchFocusSide,
    toggleFullscreen,
    exitFullscreen,
    fullscreenActive: () => fullscreenTarget() !== null,
    cycleSortColumn,
    toggleSortDirection,
  });

  useKeyboard((event) => {
    handleKey({ name: event.name, shift: event.shift });
  });

  /** Read last-good cache files synchronously and populate metrics for instant frame 1. */
  function loadCachedData() {
    const cacheDir = join(homedir(), ".cache", "lazyusage");
    for (const service of visibleServices) {
      try {
        const cacheFile = join(cacheDir, `${service}.json`);
        if (!existsSync(cacheFile)) continue;
        const data = JSON.parse(readFileSync(cacheFile, "utf-8")) as { metrics?: MetricsDict };
        if (data.metrics) {
          updateMetrics(service, data.metrics, null, DataSource.CACHE);
        }
      } catch {
        // Cache read is best-effort
      }
    }
  }

  async function startup() {
    // Show stale cached data on frame 1, before any async chain/credential work
    loadCachedData();

    try {
      store = deps.createUsageStore();
      // Clean up rows older than 30 days to prevent unbounded table growth
      try {
        store.cleanupOldSnapshots();
      } catch {}
    } catch {
      // Database not critical
    }

    daemonDetection.detect();
    const daemonBackedServices = daemonDetection.daemonBackedServices();
    const daemonMetrics = daemonDetection.daemonMetrics();

    for (const service of visibleServices) {
      if (!daemonBackedServices[service]) {
        continue;
      }

      const metrics = daemonMetrics[service];
      if (!metrics) {
        continue;
      }

      updateMetrics(service, metrics, null, "daemon");
    }

    for (const service of visibleServices) {
      if (!daemonBackedServices[service]) {
        chains.set(service, deps.createChain(service, true));
      }
    }

    const firstService = visibleServices[0];
    if (firstService && firstService !== activePanel()) {
      setActivePanel(firstService);
    }

    // Start all chains concurrently instead of sequentially
    await Promise.all(
      [...chains].map(async ([service, chain]) => {
        try {
          const result = await chain.start();
          const metrics = result.metrics as MetricsDict | null;
          updateMetrics(service, metrics, result.error, result.source);
          checkWarning(service, result);

          if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
            store.storeSnapshot(service, metrics, result.source);
          }
        } catch (err) {
          updateMetrics(service, null, String(err), DataSource.FALLBACK);
        }
      }),
    );

    setLastUpdated(new Date().toLocaleTimeString());
    autoRefresh.startTimer();

    // Initial ledger load
    ledger.refresh(true);
  }

  function cleanup() {
    ledger.killAll();
    for (const chain of chains.values()) {
      chain.stop().catch(() => {});
    }
    store?.close();
  }

  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    clockTimer = deps.setIntervalFn(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    tickTimer = deps.setIntervalFn(() => setTick((t) => t + 1), 30_000);
    startup();
  });

  onCleanup(() => {
    if (clockTimer) deps.clearIntervalFn(clockTimer);
    if (tickTimer) deps.clearIntervalFn(tickTimer);
    cleanup();
  });

  const footerHints = () => {
    const panels = visibleServices.flatMap((service) => {
      const { label } = SERVICES[service];
      return [`[${PANEL_KEYS[service].bars}]${label}`, `[${PANEL_KEYS[service].stats}]${label}Stats`];
    });
    return ` ${panels.join("  ")}  j/k=Navigate  Tab=Focus  g=Fullscreen  [/]=Stats Tab  s=Sort  S=Dir  r=Refresh  p=Pause  ?=Help  q=Quit`;
  };

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.base}>
      {/* One row per visible service */}
      <For each={visibleServices}>
        {(service) => (
          <box flexDirection="row" flexGrow={1} width="100%">
            <box width="40%">
              <ServicePanel
                service={service}
                title={SERVICES[service].title}
                metrics={metricsFor(service)}
                error={errorFor(service)}
                isActive={activePanel() === service && focusedSide() === "service"}
                selectedIndex={activePanel() === service ? selectedMetricIndex() : -1}
                panelNumber={Number(PANEL_KEYS[service].bars)}
                panelCount={visibleServices.length}
                tick={tick()}
                prediction={predictionFor(service) ?? undefined}
              />
            </box>
            <box width="60%">
              <StatsPanel
                contentTab={displayedStatsTab(service)}
                service={service}
                daily={ledger.ledgerFor(service)?.daily ?? null}
                weekly={ledger.ledgerFor(service)?.weekly ?? null}
                monthly={ledger.ledgerFor(service)?.monthly ?? null}
                graphAvailable={graphAvailableFor(service)}
                graphMetricKey={selectedMetricKeyFor(service)}
                graphMetrics={metricsFor(service)}
                graphPrediction={graphPredictionFor(service) ?? undefined}
                createGraphStore={deps.createGraphStore}
                loading={ledger.loading()}
                error={ledger.error()}
                isActive={activePanel() === service && focusedSide() === "stats"}
                panelNumber={Number(PANEL_KEYS[service].stats)}
                sortState={sortState()}
              />
            </box>
          </box>
        )}
      </For>

      {/* Status bar */}
      <StatusBar
        lastUpdated={lastUpdated()}
        currentTime={currentTime()}
        autoRefreshEnabled={autoRefresh.enabled()}
        refreshInterval={autoRefresh.interval()}
        dataSource={dataSources()}
        warnings={warnings()}
      />
      {/* Footer keybinding hints */}
      <text content={footerHints()} fg={theme.blue} height={1} flexShrink={0} paddingLeft={1} />

      {/* Fullscreen metric overlay */}
      <Show when={fullscreenTarget() === "service"}>
        <FullscreenMetricView
          service={activePanel()}
          metricKey={selectedMetricKey()}
          metrics={metricsFor(activePanel())}
          tick={tick()}
          prediction={predictionFor(activePanel()) ?? undefined}
        />
      </Show>

      {/* Fullscreen stats overlay */}
      <Show when={fullscreenTarget() === "stats" && displayedStatsTab(activePanel()) !== "graph"}>
        <FullscreenStatsView
          service={activePanel()}
          contentTab={contentTab()}
          daily={ledger.ledgerFor(activePanel())?.daily ?? null}
          weekly={ledger.ledgerFor(activePanel())?.weekly ?? null}
          monthly={ledger.ledgerFor(activePanel())?.monthly ?? null}
          loading={ledger.loading()}
          error={ledger.error()}
          sortState={sortState()}
        />
      </Show>

      <Show when={fullscreenTarget() === "stats" && displayedStatsTab(activePanel()) === "graph"}>
        <FullscreenGraphView
          service={activePanel()}
          selectedMetricKey={selectedMetricKeyFor(activePanel())}
          metrics={metricsFor(activePanel())}
          prediction={graphPredictionFor(activePanel()) ?? undefined}
          createGraphStore={deps.createGraphStore}
        />
      </Show>

      {/* Help overlay */}
      <HelpOverlay visible={helpVisible()} onClose={() => setHelpVisible(false)} />
    </box>
  );
}
