/**
 * Registry of monitored services. Everything that varies per service
 * (display names, CLI binary, metric layout) lives here so adding a service
 * is one entry rather than a new branch at every call site.
 */

import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "./constants.js";

/** Monitored services, in display order. */
export const SERVICE_NAMES = ["claude", "codex", "grok"] as const;

/** Service name literal */
export type ServiceName = (typeof SERVICE_NAMES)[number];

/** One allowance metric as it is labelled in text output. */
export interface ServiceMetricSpec {
  key: string;
  /** Label in `--text` / `--capacity` output */
  textLabel: string;
  windowHours: number;
  /** Optional metrics are omitted from text output when the provider does not report them. */
  optional?: boolean;
}

export interface ServiceDescriptor {
  name: ServiceName;
  /** Short display name, e.g. "Codex" */
  label: string;
  /** Panel title in the TUI */
  title: string;
  /** Executable looked up on PATH to decide availability */
  binary: string;
  /** Command shown to the user to re-authenticate */
  loginCommand: string;
  /** Metrics in text output order */
  textMetrics: ServiceMetricSpec[];
  /** Metrics in TUI bar order (first is selected by default) */
  panelMetrics: string[];
  /** Weekly metrics the prediction engine projects */
  predictableMetrics: string[];
  /**
   * Listed in text/JSON output even when not installed ("[not available]", `available: false`).
   * True for the original services so that output contract stays stable; services added
   * later appear only when installed or collected.
   */
  alwaysListed: boolean;
}

export const SERVICES: Record<ServiceName, ServiceDescriptor> = {
  claude: {
    name: "claude",
    label: "Claude",
    title: "Claude CLI",
    binary: "claude",
    loginCommand: "claude",
    textMetrics: [
      { key: "session", textLabel: "Session", windowHours: SESSION_WINDOW_HOURS },
      { key: "week_all", textLabel: "Weekly", windowHours: WEEKLY_WINDOW_HOURS },
      { key: "week_sonnet", textLabel: "Fable", windowHours: WEEKLY_WINDOW_HOURS },
    ],
    panelMetrics: ["week_all", "week_sonnet", "session"],
    predictableMetrics: ["week_all", "week_sonnet"],
    alwaysListed: true,
  },
  codex: {
    name: "codex",
    label: "Codex",
    title: "Codex CLI",
    binary: "codex",
    loginCommand: "codex login",
    textMetrics: [
      { key: "5h", textLabel: "Session", windowHours: SESSION_WINDOW_HOURS, optional: true },
      { key: "weekly", textLabel: "Weekly", windowHours: WEEKLY_WINDOW_HOURS },
    ],
    panelMetrics: ["weekly", "5h"],
    predictableMetrics: ["weekly"],
    alwaysListed: true,
  },
  grok: {
    name: "grok",
    label: "Grok",
    title: "Grok Build",
    binary: "grok",
    loginCommand: "grok login",
    textMetrics: [{ key: "weekly", textLabel: "Weekly", windowHours: WEEKLY_WINDOW_HOURS }],
    panelMetrics: ["weekly"],
    predictableMetrics: ["weekly"],
    alwaysListed: false,
  },
};

/** Services to list in output: always-listed ones plus any that are installed or were collected. */
export function listedServices(availableServices: readonly string[], collected: readonly string[] = []): ServiceName[] {
  return SERVICE_NAMES.filter(
    (s) => SERVICES[s].alwaysListed || availableServices.includes(s) || collected.includes(s),
  );
}

export function isServiceName(value: unknown): value is ServiceName {
  return typeof value === "string" && (SERVICE_NAMES as readonly string[]).includes(value);
}
