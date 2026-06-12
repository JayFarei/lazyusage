/**
 * Root TUI application component.
 * 2x2 grid layout: each service row has bars (left) + ledger stats (right).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type CapacityPrediction,
  createClaudeChain,
  createCodexChain,
  DataSource,
  DedupTracker,
  type MetricsDict,
  type PersistentFallbackChain,
  UsageStore,
} from "@lazyusage/core";
import { useKeyboard } from "@opentui/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { FullscreenGraphView } from "./components/FullscreenGraphView.js";
import { FullscreenMetricView } from "./components/FullscreenMetricView.js";
import { FullscreenStatsView } from "./components/FullscreenStatsView.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
import { METRIC_KEYS, ServicePanel } from "./components/ServicePanel.js";
import { StatsPanel } from "./components/StatsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAutoRefresh } from "./hooks/useAutoRefresh.js";
import { type DaemonDetectionHook, useDaemonDetection } from "./hooks/useDaemonDetection.js";
import { createKeybindingHandler } from "./hooks/useKeybindings.js";
import { useLedgerData } from "./hooks/useLedgerData.js";
import { useMetrics } from "./hooks/useMetrics.js";
import { usePrediction } from "./hooks/usePrediction.js";
import { usePanelState } from "./hooks/useViewMode.js";
import { useTheme } from "./theme.js";

export interface AppProps {
  /** Optional service filter: "claude" | "codex" | "all" | undefined = show both */
  service?: "claude" | "codex" | "all";
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
  createClaudeChain: (persistent: boolean) => AppChain;
  createCodexChain: (persistent: boolean) => AppChain;
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
    createClaudeChain:
      props.deps?.createClaudeChain ?? ((persistent: boolean) => createClaudeChain(persistent) as AppChain),
    createCodexChain:
      props.deps?.createCodexChain ?? ((persistent: boolean) => createCodexChain(persistent) as AppChain),
    setIntervalFn: props.deps?.setIntervalFn ?? setInterval,
    clearIntervalFn: props.deps?.clearIntervalFn ?? clearInterval,
  };

  const showClaude = () => !props.service || props.service === "all" || props.service === "claude";
  const showCodex = () => !props.service || props.service === "all" || props.service === "codex";
  const theme = useTheme();
  const { claudeMetrics, codexMetrics, claudeError, codexError, dataSources, warnings, updateMetrics, checkWarning } =
    useMetrics();
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
  } = usePanelState();
  const [lastUpdated, setLastUpdated] = createSignal<string | null>(null);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [graphTabPanel, setGraphTabPanel] = createSignal<"claude" | "codex" | null>(null);
  const [currentTime, setCurrentTime] = createSignal(new Date().toLocaleTimeString());

  // Shared 30s tick for time-progress bars (replaces two per-panel setIntervals)
  const [tick, setTick] = createSignal(0);

  const ledger: AppLedgerData = deps.createLedgerData();
  const daemonDetection = deps.createDaemonDetection();

  // Prediction engine: runs on each tick, produces prediction data for weekly bars
  const { claudePrediction, codexPrediction }: AppPrediction = deps.createPrediction(tick, claudeMetrics, codexMetrics);

  const visiblePanelCount = () => (showClaude() ? 1 : 0) + (showCodex() ? 1 : 0);

  // Provider chains
  let claudeChain: AppChain | null = null;
  let codexChain: AppChain | null = null;

  // Storage
  let store: AppStore | null = null;
  const dedup = deps.createDedupTracker();

  async function applyFetchResult(service: "claude" | "codex", result: Awaited<ReturnType<AppChain["refresh"]>>) {
    const metrics = result.metrics as MetricsDict | null;
    const error = result.error;
    const source = result.source;
    updateMetrics(service, metrics, error, source);
    checkWarning(service, result);

    if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
      store.storeSnapshot(service, metrics, source);
    }
  }

  function handleRefreshError(service: "claude" | "codex", err: unknown) {
    updateMetrics(service, null, String(err), DataSource.FALLBACK);
  }

  async function refreshTrackedChain(service: "claude" | "codex", chain: AppChain) {
    try {
      const result = await chain.refresh();
      await applyFetchResult(service, result);
    } catch (err) {
      handleRefreshError(service, err);
    }
  }

  async function refreshDaemonBackedService(
    service: "claude" | "codex",
    createChain: (persistent: boolean) => AppChain,
  ) {
    const temporaryChain = createChain(true);

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
    const activeChains = (
      [
        [claudeChain, "claude"],
        [codexChain, "codex"],
      ] as const
    ).flatMap(([chain, service]) => (chain ? [[chain, service] as const] : []));

    await Promise.all([
      ...activeChains.map(([chain, service]) => refreshTrackedChain(service, chain)),
      ledger.refresh(),
    ]);
  }

  async function refreshOnDemand() {
    setLastUpdated(new Date().toLocaleTimeString());

    const daemonBackedServices = daemonDetection.daemonBackedServices();

    await Promise.all([
      ...(showClaude()
        ? [
            claudeChain
              ? refreshTrackedChain("claude", claudeChain)
              : daemonBackedServices.claude
                ? refreshDaemonBackedService("claude", deps.createClaudeChain)
                : Promise.resolve(),
          ]
        : []),
      ...(showCodex()
        ? [
            codexChain
              ? refreshTrackedChain("codex", codexChain)
              : daemonBackedServices.codex
                ? refreshDaemonBackedService("codex", deps.createCodexChain)
                : Promise.resolve(),
          ]
        : []),
      ledger.refresh(true),
    ]);
  }

  const autoRefresh: AppAutoRefresh = deps.createAutoRefresh(refreshAll, 10);

  const isServiceVisible = (panel: "claude" | "codex") => (panel === "claude" ? showClaude() : showCodex());
  const graphAvailableFor = (service: "claude" | "codex") => daemonDetection.daemonBackedServices()[service];
  const selectedMetricKeyFor = (service: "claude" | "codex") =>
    activePanel() === service ? selectedMetricKey() : (METRIC_KEYS[service][0] ?? selectedMetricKey());
  const graphPredictionFor = (service: "claude" | "codex"): Record<string, CapacityPrediction> | null =>
    service === "claude" ? claudePrediction() : codexPrediction();

  const displayedStatsTab = (service: "claude" | "codex"): StatsTab =>
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

  const setActivePanelIfVisible = (panel: "claude" | "codex") => {
    if (!isServiceVisible(panel)) return;
    setActivePanel(panel);
  };

  const focusStatsIfVisible = (panel: "claude" | "codex") => {
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
    for (const [service, visible] of [
      ["claude", showClaude()],
      ["codex", showCodex()],
    ] as const) {
      if (!visible) continue;
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

    for (const [service, visible] of [
      ["claude", showClaude()],
      ["codex", showCodex()],
    ] as const) {
      if (!visible || !daemonBackedServices[service]) {
        continue;
      }

      const metrics = daemonMetrics[service];
      if (!metrics) {
        continue;
      }

      updateMetrics(service, metrics, null, "daemon");
    }

    if (showClaude() && !daemonBackedServices.claude) {
      claudeChain = deps.createClaudeChain(true);
    }
    if (showCodex() && !daemonBackedServices.codex) {
      codexChain = deps.createCodexChain(true);
    }

    if (!showClaude() && showCodex()) {
      setActivePanel("codex");
    }

    // Start both chains concurrently instead of sequentially
    const startupChains = (
      [
        [claudeChain, "claude"],
        [codexChain, "codex"],
      ] as const
    ).flatMap(([chain, service]) => (chain ? [[chain, service] as const] : []));

    await Promise.all(
      startupChains.map(async ([chain, service]) => {
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
    claudeChain?.stop().catch(() => {});
    codexChain?.stop().catch(() => {});
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
    const panels: string[] = [];
    if (showClaude()) {
      panels.push("[1]Claude");
      panels.push("[3]ClaudeStats");
    }
    if (showCodex()) {
      panels.push("[2]Codex");
      panels.push("[4]CodexStats");
    }
    return ` ${panels.join("  ")}  j/k=Navigate  Tab=Focus  g=Fullscreen  [/]=Stats Tab  s=Sort  S=Dir  r=Refresh  p=Pause  ?=Help  q=Quit`;
  };

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.base}>
      {/* Row 1: Claude (shown when service=claude or service=all/undefined) */}
      <Show when={showClaude()}>
        <box flexDirection="row" flexGrow={1} width="100%">
          <box width="40%">
            <ServicePanel
              service="claude"
              title="Claude CLI"
              metrics={claudeMetrics()}
              error={claudeError()}
              isActive={activePanel() === "claude" && focusedSide() === "service"}
              selectedIndex={activePanel() === "claude" ? selectedMetricIndex() : -1}
              panelNumber={1}
              panelCount={visiblePanelCount()}
              tick={tick()}
              prediction={claudePrediction() ?? undefined}
            />
          </box>
          <box width="60%">
            <StatsPanel
              contentTab={displayedStatsTab("claude")}
              service="claude"
              daily={ledger.claudeDaily()}
              weekly={ledger.claudeWeekly()}
              monthly={ledger.claudeMonthly()}
              graphAvailable={graphAvailableFor("claude")}
              graphMetricKey={selectedMetricKeyFor("claude")}
              graphMetrics={claudeMetrics()}
              graphPrediction={graphPredictionFor("claude") ?? undefined}
              createGraphStore={deps.createGraphStore}
              loading={ledger.loading()}
              error={ledger.error()}
              isActive={activePanel() === "claude" && focusedSide() === "stats"}
              panelNumber={3}
              sortState={sortState()}
            />
          </box>
        </box>
      </Show>

      {/* Row 2: Codex (shown when service=codex or service=all/undefined) */}
      <Show when={showCodex()}>
        <box flexDirection="row" flexGrow={1} width="100%">
          <box width="40%">
            <ServicePanel
              service="codex"
              title="Codex CLI"
              metrics={codexMetrics()}
              error={codexError()}
              isActive={activePanel() === "codex" && focusedSide() === "service"}
              selectedIndex={activePanel() === "codex" ? selectedMetricIndex() : -1}
              panelNumber={2}
              panelCount={visiblePanelCount()}
              tick={tick()}
              prediction={codexPrediction() ?? undefined}
            />
          </box>
          <box width="60%">
            <StatsPanel
              contentTab={displayedStatsTab("codex")}
              service="codex"
              daily={ledger.codexDaily()}
              weekly={ledger.codexWeekly()}
              monthly={ledger.codexMonthly()}
              graphAvailable={graphAvailableFor("codex")}
              graphMetricKey={selectedMetricKeyFor("codex")}
              graphMetrics={codexMetrics()}
              graphPrediction={graphPredictionFor("codex") ?? undefined}
              createGraphStore={deps.createGraphStore}
              loading={ledger.loading()}
              error={ledger.error()}
              isActive={activePanel() === "codex" && focusedSide() === "stats"}
              panelNumber={4}
              sortState={sortState()}
            />
          </box>
        </box>
      </Show>

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
          metrics={activePanel() === "claude" ? claudeMetrics() : codexMetrics()}
          tick={tick()}
          prediction={(activePanel() === "claude" ? claudePrediction() : codexPrediction()) ?? undefined}
        />
      </Show>

      {/* Fullscreen stats overlay */}
      <Show when={fullscreenTarget() === "stats" && displayedStatsTab(activePanel()) !== "graph"}>
        <FullscreenStatsView
          service={activePanel()}
          contentTab={contentTab()}
          daily={activePanel() === "claude" ? ledger.claudeDaily() : ledger.codexDaily()}
          weekly={activePanel() === "claude" ? ledger.claudeWeekly() : ledger.codexWeekly()}
          monthly={activePanel() === "claude" ? ledger.claudeMonthly() : ledger.codexMonthly()}
          loading={ledger.loading()}
          error={ledger.error()}
          sortState={sortState()}
        />
      </Show>

      <Show when={fullscreenTarget() === "stats" && displayedStatsTab(activePanel()) === "graph"}>
        <FullscreenGraphView
          service={activePanel()}
          selectedMetricKey={selectedMetricKeyFor(activePanel())}
          metrics={activePanel() === "claude" ? claudeMetrics() : codexMetrics()}
          prediction={graphPredictionFor(activePanel()) ?? undefined}
          createGraphStore={deps.createGraphStore}
        />
      </Show>

      {/* Help overlay */}
      <HelpOverlay visible={helpVisible()} onClose={() => setHelpVisible(false)} />
    </box>
  );
}
