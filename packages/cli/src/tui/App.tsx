/**
 * Root TUI application component.
 * 2x2 grid layout: each service row has bars (left) + ledger stats (right).
 */
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "./theme.js";
import { ServicePanel } from "./components/ServicePanel.js";
import { StatsPanel } from "./components/ContentPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { HelpOverlay } from "./components/HelpOverlay.js";
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

export function App() {
  const theme = useTheme();
  const { claudeMetrics, codexMetrics, claudeError, codexError, dataSources, updateMetrics } =
    useMetrics();
  const {
    activePanel, setActivePanel,
    contentTab,
    selectedMetricIndex,
    navigateMetric, cycleTab,
  } = usePanelState();
  const [lastUpdated, setLastUpdated] = createSignal<string | null>(null);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString()
  );

  const ledger = useLedgerData();

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
    " [1]Claude  [2]Codex  j/k=Navigate  [/]=Stats Tab  r=Refresh  p=Pause  ?=Help  q=Quit";

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.base}
    >
      {/* Row 1: Claude */}
      <box flexDirection="row" flexGrow={1} width="100%">
        <box width="40%">
          <ServicePanel
            service="claude"
            title="Claude CLI"
            metrics={claudeMetrics()}
            error={claudeError()}
            isActive={activePanel() === "claude"}
            selectedIndex={activePanel() === "claude" ? selectedMetricIndex() : -1}
            panelNumber={1}
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
          />
        </box>
      </box>

      {/* Row 2: Codex */}
      <box flexDirection="row" flexGrow={1} width="100%">
        <box width="40%">
          <ServicePanel
            service="codex"
            title="Codex CLI"
            metrics={codexMetrics()}
            error={codexError()}
            isActive={activePanel() === "codex"}
            selectedIndex={activePanel() === "codex" ? selectedMetricIndex() : -1}
            panelNumber={2}
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
          />
        </box>
      </box>

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

      {/* Help overlay */}
      <HelpOverlay
        visible={helpVisible()}
        onClose={() => setHelpVisible(false)}
      />
    </box>
  );
}
