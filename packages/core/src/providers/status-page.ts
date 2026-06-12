/**
 * Polls provider status pages for degradation notices.
 * Uses Atlassian StatusPage API (common format for both Anthropic and OpenAI).
 */
import { API_TIMEOUT_MS } from "../constants.js";

export interface StatusPageResult {
  provider: string;
  status: "operational" | "degraded" | "major_outage" | "unknown";
  description: string | null;
  updatedAt: string | null;
}

const STATUS_PAGES: Record<string, string> = {
  anthropic: "https://status.anthropic.com/api/v2/status.json",
  openai: "https://status.openai.com/api/v2/status.json",
};

interface AtlassianStatusResponse {
  status?: {
    indicator?: string;
    description?: string;
  };
  page?: {
    updated_at?: string;
  };
}

function mapIndicator(indicator: string | undefined): StatusPageResult["status"] {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
    case "major":
      return "degraded";
    case "critical":
      return "major_outage";
    default:
      return "unknown";
  }
}

/**
 * Poll a single provider's status page.
 */
export async function pollStatusPage(provider: string): Promise<StatusPageResult> {
  const url = STATUS_PAGES[provider];
  if (!url) {
    return { provider, status: "unknown", description: "Unknown provider", updatedAt: null };
  }

  try {
    const resp = await globalThis.fetch(url, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return { provider, status: "unknown", description: `HTTP ${resp.status}`, updatedAt: null };
    }

    const data = (await resp.json()) as AtlassianStatusResponse;
    return {
      provider,
      status: mapIndicator(data.status?.indicator),
      description: data.status?.description ?? null,
      updatedAt: data.page?.updated_at ?? null,
    };
  } catch {
    return { provider, status: "unknown", description: "Status page unreachable", updatedAt: null };
  }
}

/**
 * Poll all known status pages concurrently.
 */
export async function pollAllStatusPages(): Promise<StatusPageResult[]> {
  return Promise.all(Object.keys(STATUS_PAGES).map((provider) => pollStatusPage(provider)));
}

/**
 * Check if any provider has degraded status and return a warning-compatible message.
 */
export function statusToWarningMessage(results: StatusPageResult[]): string | null {
  const degraded = results.filter((r) => r.status === "degraded" || r.status === "major_outage");
  if (degraded.length === 0) return null;

  return degraded
    .map(
      (r) =>
        `${r.provider}: ${r.status === "major_outage" ? "major outage" : "degraded"}${r.description ? ` - ${r.description}` : ""}`,
    )
    .join("; ");
}
