/**
 * Root TUI application component.
 * 2x2 grid layout: each service row has bars (left) + ledger stats (right).
 */
import { createSignal, onMount, onCleanup, Show } from "solid-js";
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
import {
  createClaudeChain,
  createCodexChain,
  UsageStore,
  DedupTracker,
  DataSource,
  type PersistentFallbackChain,
  type MetricsDict,
} from "@usage-tui/core";

export interface AppProps {
  /** Optional service filter: "claude" | "codex" | "all" | undefined = show both */
  service?: "claude" | "codex" | "all";
}

export function App(props: AppProps = {}) {
  const showClaude = () => !props.service || props.service === "all" || props.service === "claude";
  const showCodex = () => !props.service || props.service === "all" || props.service === "codex";
  const theme = useTheme();
  const { claudeMetrics, codexMetrics, claudeError, codexError, dataSources, updateMetrics } =
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
  } = usePanelState();
  const [lastUpdated, setLastUpdated] = createSignal<string | null>(null);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString()
  );

  const ledger = useLedgerData();

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

    for (const [chain, service] of [
      [claudeChain, "claude"],
      [codexChain, "codex"],
    ] as const) {
      if (!chain) continue;
      try {
        const result = await (chain as PersistentFallbackChain).refresh();
        const metrics = result.metrics as MetricsDict | null;
        const error = result.error;
        const source = result.source;
        updateMetrics(service, metrics, error, source);

        if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
          store.storeSnapshot(service, metrics, source);
        }
      } catch (err) {
        updateMetrics(service, null, String(err), DataSource.FALLBACK);
      }
    }

    // Throttled ledger refresh (30s internal throttle)
    ledger.refresh();
  }

  const autoRefresh = useAutoRefresh(refreshAll, 10);

  // Keybindings
  const handleKey = createKeybindingHandler({
    setActivePanel,
    focusStatsPanel,
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
  });

  useKeyboard((event) => {
    handleKey({ name: event.name, shift: event.shift });
  });

  async function startup() {
    try {
      store = new UsageStore();
    } catch {
      // Database not critical
    }

    claudeChain = createClaudeChain(true) as PersistentFallbackChain;
    codexChain = createCodexChain(true) as PersistentFallbackChain;

    for (const [chain, service] of [
      [claudeChain, "claude"],
      [codexChain, "codex"],
    ] as const) {
      try {
        const result = await (chain as PersistentFallbackChain).start();
        const metrics = result.metrics as MetricsDict | null;
        updateMetrics(service, metrics, result.error, result.source);

        if (store && metrics && dedup.shouldStoreMetrics(service, metrics)) {
          store.storeSnapshot(service, metrics, result.source);
        }
      } catch (err) {
        updateMetrics(service, null, String(err), DataSource.FALLBACK);
      }
    }

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

  onMount(() => {
    clockTimer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    startup();
  });

  onCleanup(() => {
    if (clockTimer) clearInterval(clockTimer);
    cleanup();
  });

  const footerHints = () =>
    " [1]Claude  [2]Codex  [3]ClaudeStats  [4]CodexStats  j/k=Navigate  Tab=Focus  g=Fullscreen  [/]=Stats Tab  r=Refresh  p=Pause  ?=Help  q=Quit";

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
      />
      {/* Footer keybinding hints */}
      <text content={footerHints()} fg={theme.blue} height={1} paddingLeft={1} />

      {/* Fullscreen metric overlay */}
      <Show when={fullscreenTarget() === "service"}>
        <FullscreenMetricView
          service={activePanel()}
          metricKey={selectedMetricKey()}
          metrics={activePanel() === "claude" ? claudeMetrics() : codexMetrics()}
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
