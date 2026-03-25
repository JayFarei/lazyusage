/**
 * Root TUI application component.
 * 2x2 grid layout: each service row has bars (left) + ledger stats (right).
 */
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "./theme.js";
import { ServicePanel } from "./components/ServicePanel.js";
import { StatsPanel } from "./components/StatsPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
import { FullscreenMetricView } from "./components/FullscreenMetricView.js";
import { FullscreenStatsView } from "./components/FullscreenStatsView.js";
import { useMetrics } from "./hooks/useMetrics.js";
import { useAutoRefresh } from "./hooks/useAutoRefresh.js";
import { usePanelState } from "./hooks/useViewMode.js";
import { useLedgerData } from "./hooks/useLedgerData.js";
import { createKeybindingHandler } from "./hooks/useKeybindings.js";
import { usePrediction } from "./hooks/usePrediction.js";
import {
  createClaudeChain,
  createCodexChain,
  UsageStore,
  DedupTracker,
  DataSource,
  type PersistentFallbackChain,
  type MetricsDict,
} from "@lazyusage/core";

export interface AppProps {
  /** Optional service filter: "claude" | "codex" | "all" | undefined = show both */
  service?: "claude" | "codex" | "all";
}

export function App(props: AppProps = {}) {
  const showClaude = () => !props.service || props.service === "all" || props.service === "claude";
  const showCodex = () => !props.service || props.service === "all" || props.service === "codex";
  const theme = useTheme();
  const { claudeMetrics, codexMetrics, claudeError, codexError, dataSources, warnings, updateMetrics, checkWarning } =
    useMetrics();
  const {
    activePanel, setActivePanel,
    focusStatsPanel,
    contentTab,
    selectedMetricIndex,
    selectedMetricKey,
    navigateMetric, cycleTab,
    focusedSide,
    fullscreenTarget, toggleFullscreen, exitFullscreen,
    switchFocusSide,
    sortState, cycleSortColumn, toggleSortDirection,
  } = usePanelState();
  const [lastUpdated, setLastUpdated] = createSignal<string | null>(null);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString()
  );

  // Shared 30s tick for time-progress bars (replaces two per-panel setIntervals)
  const [tick, setTick] = createSignal(0);

  const ledger = useLedgerData();

  // Prediction engine: runs on each tick, produces prediction data for weekly bars
  const { claudePrediction, codexPrediction } = usePrediction(tick, claudeMetrics, codexMetrics);

  const visiblePanelCount = () => (showClaude() ? 1 : 0) + (showCodex() ? 1 : 0);

  // Provider chains
  let claudeChain: PersistentFallbackChain | null = null;
  let codexChain: PersistentFallbackChain | null = null;

  // Storage
  let store: UsageStore | null = null;
  const dedup = new DedupTracker();

  async function refreshAll() {
    const timestamp = new Date().toLocaleTimeString();
    setLastUpdated(timestamp);

    // Refresh both chains and ledger concurrently
    await Promise.all([
      ...([
        [claudeChain, "claude"],
        [codexChain, "codex"],
      ] as const)
        .filter(([chain]) => chain !== null)
        .map(async ([chain, service]) => {
          try {
            const result = await (chain as PersistentFallbackChain).refresh();
            const metrics = result.metrics as MetricsDict | null;
            const error = result.error;
            const source = result.source;
            updateMetrics(service, metrics, error, source);
            checkWarning(service, result);

            if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
              store.storeSnapshot(service, metrics, source);
            }
          } catch (err) {
            updateMetrics(service, null, String(err), DataSource.FALLBACK);
          }
        }),
      ledger.refresh(),
    ]);
  }

  const autoRefresh = useAutoRefresh(refreshAll, 10);

  const isServiceVisible = (panel: "claude" | "codex") =>
    panel === "claude" ? showClaude() : showCodex();

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
    cycleTab,
    togglePause: autoRefresh.togglePause,
    triggerRefresh: () => {
      if (ledger.loading()) return;
      refreshAll();
      ledger.refresh(true);
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
      store = new UsageStore();
      // Clean up rows older than 30 days to prevent unbounded table growth
      try { store.cleanupOldSnapshots(); } catch {}
    } catch {
      // Database not critical
    }

    if (showClaude()) {
      claudeChain = createClaudeChain(true) as PersistentFallbackChain;
    }
    if (showCodex()) {
      codexChain = createCodexChain(true) as PersistentFallbackChain;
    }

    if (!showClaude() && showCodex()) {
      setActivePanel("codex");
    }

    // Start both chains concurrently instead of sequentially
    await Promise.all(
      ([
        [claudeChain, "claude"],
        [codexChain, "codex"],
      ] as const)
        .filter(([chain]) => chain !== null)
        .map(async ([chain, service]) => {
          try {
            const result = await (chain as PersistentFallbackChain).start();
            const metrics = result.metrics as MetricsDict | null;
            updateMetrics(service, metrics, result.error, result.source);
            checkWarning(service, result);

            if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
              store.storeSnapshot(service, metrics, result.source);
            }
          } catch (err) {
            updateMetrics(service, null, String(err), DataSource.FALLBACK);
          }
        })
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
    clockTimer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    tickTimer = setInterval(() => setTick((t) => t + 1), 30_000);
    startup();
  });

  onCleanup(() => {
    if (clockTimer) clearInterval(clockTimer);
    if (tickTimer) clearInterval(tickTimer);
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
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.base}
    >
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
              contentTab={contentTab()}
              service="claude"
              daily={ledger.claudeDaily()}
              weekly={ledger.claudeWeekly()}
              monthly={ledger.claudeMonthly()}
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
              contentTab={contentTab()}
              service="codex"
              daily={ledger.codexDaily()}
              weekly={ledger.codexWeekly()}
              monthly={ledger.codexMonthly()}
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
      <Show when={fullscreenTarget() === "stats"}>
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

      {/* Help overlay */}
      <HelpOverlay
        visible={helpVisible()}
        onClose={() => setHelpVisible(false)}
      />
    </box>
  );
}
