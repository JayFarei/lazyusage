/**
 * HTTP server for usage metrics using Bun.serve().
 * Provides REST + SSE endpoints for upstream dashboard integration.
 */
import {
  createClaudeChain,
  createCodexChain,
  formatCombinedJson,
  type MetricsDict,
  type FallbackChain,
} from "@lazyusage/core";

async function collectMetrics(
  servicesToQuery: string[],
): Promise<{ claudeMetrics: MetricsDict | null; codexMetrics: MetricsDict | null }> {
  let claudeMetrics: MetricsDict | null = null;
  let codexMetrics: MetricsDict | null = null;

  if (servicesToQuery.includes("claude")) {
    const chain = createClaudeChain(false) as FallbackChain;
    const result = await chain.fetch();
    claudeMetrics = result.metrics as MetricsDict | null;
  }

  if (servicesToQuery.includes("codex")) {
    const chain = createCodexChain(false) as FallbackChain;
    const result = await chain.fetch();
    codexMetrics = result.metrics as MetricsDict | null;
  }

  return { claudeMetrics, codexMetrics };
}

export function startServer(options: {
  services: string[];
  port: number;
  host?: string;
  refreshInterval: number;
  debug: boolean;
}) {
  const { services, port, host = "127.0.0.1", refreshInterval, debug } = options;

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 0, // SSE connections must stay open indefinitely
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/$/, "") || "/";

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Health check
      if (path === "/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            services,
            refresh_interval: refreshInterval,
          }),
          { headers: corsHeaders },
        );
      }

      // SSE streaming endpoints
      if (path.startsWith("/stream")) {
        const streamService = path === "/stream/claude"
          ? ["claude"]
          : path === "/stream/codex"
            ? ["codex"]
            : services;

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            // SSE requires newline-free data; minify before framing
            const send = (data: string) => {
              const minified = JSON.stringify(JSON.parse(data));
              controller.enqueue(encoder.encode(`data: ${minified}\n\n`));
            };

            // Heartbeat comment so EventSource confirms the connection immediately
            // (before the async collectMetrics call resolves)
            controller.enqueue(encoder.encode(": connected\n\n"));

            // Send initial data
            const { claudeMetrics, codexMetrics } = await collectMetrics(streamService);
            send(formatCombinedJson(claudeMetrics, codexMetrics, services));

            // Keepalive: send an SSE comment every 5s so Bun doesn't consider
            // the connection idle between data refreshes
            const keepalive = setInterval(() => {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            }, 5000);

            // Set up periodic refresh
            const interval = setInterval(async () => {
              try {
                const { claudeMetrics, codexMetrics } = await collectMetrics(streamService);
                send(formatCombinedJson(claudeMetrics, codexMetrics, services));
              } catch {
                // Skip failed refreshes
              }
            }, refreshInterval * 1000);

            // Clean up when client disconnects
            req.signal.addEventListener("abort", () => {
              clearInterval(keepalive);
              clearInterval(interval);
              controller.close();
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Determine services to query based on path
      let servicesToQuery = services;
      if (path === "/claude" && services.includes("claude")) {
        servicesToQuery = ["claude"];
      } else if (path === "/codex" && services.includes("codex")) {
        servicesToQuery = ["codex"];
      } else if (path !== "/" && path !== "/all") {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: corsHeaders,
        });
      }

      // Collect and return metrics
      const { claudeMetrics, codexMetrics } = await collectMetrics(servicesToQuery);
      const output = formatCombinedJson(claudeMetrics, codexMetrics, services);
      return new Response(output, { headers: corsHeaders });
    },
  });

  if (debug) {
    console.log(`Usage server running on http://${host}:${port}`);
    console.log(`Available services: ${services.join(", ")}`);
    console.log(`Refresh interval: ${refreshInterval}s`);
  } else {
    console.log(`Usage server running on http://${host}:${port}`);
  }

  return server;
}
