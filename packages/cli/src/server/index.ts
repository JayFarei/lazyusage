/**
 * HTTP server for usage metrics using Bun.serve().
 * Provides REST + SSE endpoints for upstream dashboard integration.
 */
import {
  createChain,
  type FallbackChain,
  formatCombinedJson,
  isServiceName,
  type MetricsDict,
  type ServiceMetricsMap,
  type ServiceName,
  type ServiceResourceInfo,
} from "lazyusage-core";

async function collectMetrics(servicesToQuery: ServiceName[]): Promise<{
  metrics: ServiceMetricsMap;
  serviceInfo: Partial<Record<ServiceName, ServiceResourceInfo>>;
}> {
  const metrics: ServiceMetricsMap = {};
  const serviceInfo: Partial<Record<ServiceName, ServiceResourceInfo>> = {};

  for (const service of servicesToQuery) {
    const chain = createChain(service, false) as FallbackChain;
    const result = await chain.fetch();
    metrics[service] = result.metrics as MetricsDict | null;
    serviceInfo[service] = {
      source: result.source,
      stale: result.stale,
      error: result.error,
    };
  }

  return { metrics, serviceInfo };
}

/** `/claude` -> "claude" when that is a known service, else null */
function serviceFromPath(path: string, prefix: string): ServiceName | null {
  const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  return isServiceName(name) ? name : null;
}

export function startServer(options: {
  services: ServiceName[];
  port: number;
  host?: string;
  refreshInterval: number;
  debug: boolean;
}) {
  const { services, port, host = "127.0.0.1", refreshInterval, debug } = options;

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
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
            host,
            local_only: host === "127.0.0.1" || host === "localhost",
          }),
          { headers: corsHeaders },
        );
      }

      // SSE streaming endpoints
      if (path.startsWith("/stream")) {
        const streamTarget = serviceFromPath(path, "/stream/");
        const streamService = streamTarget ? [streamTarget] : services;

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
            const { metrics, serviceInfo } = await collectMetrics(streamService);
            send(formatCombinedJson(metrics, services, undefined, serviceInfo));

            // Keepalive: send an SSE comment every 5s so Bun doesn't consider
            // the connection idle between data refreshes
            const keepalive = setInterval(() => {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            }, 5000);

            // Set up periodic refresh
            const interval = setInterval(async () => {
              try {
                const { metrics, serviceInfo } = await collectMetrics(streamService);
                send(formatCombinedJson(metrics, services, undefined, serviceInfo));
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
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Determine services to query based on path
      let servicesToQuery = services;
      const pathService = serviceFromPath(path, "/");
      if (pathService && services.includes(pathService)) {
        servicesToQuery = [pathService];
      } else if (path !== "/" && path !== "/all") {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: corsHeaders,
        });
      }

      // Collect and return metrics
      const { metrics, serviceInfo } = await collectMetrics(servicesToQuery);
      const output = formatCombinedJson(metrics, services, undefined, serviceInfo);
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
