import { useState } from "react";
import { useUsageStream } from "./hooks/useUsageStream";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { ServiceCard } from "./components/ServiceCard";

function getDefaultPort(): number {
  const params = new URLSearchParams(window.location.search);
  const p = parseInt(params.get("port") ?? "8080", 10);
  return isNaN(p) || p <= 0 ? 8080 : p;
}

export default function App() {
  const [port, setPort] = useState(getDefaultPort);
  const { data, status, error } = useUsageStream(port);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">lazyusage dashboard</h1>
        {data && (
          <span className="text-xs text-gray-500">
            Last updated: {new Date(data.timestamp).toLocaleTimeString()}
          </span>
        )}
      </header>

      <ConnectionBanner
        status={status}
        error={error}
        port={port}
        onPortChange={setPort}
      />

      <main className="flex-1 p-6">
        {(status === "connecting" || status === "connected") && !data && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-gray-500">
            <div className="w-5 h-5 border-2 border-gray-600 border-t-green-500 rounded-full animate-spin" />
            <span className="text-sm">
              {status === "connected" ? "Fetching metrics…" : "Connecting to lazyusage server…"}
            </span>
          </div>
        )}

        {status === "error" && !data && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
            <p className="text-red-400 font-medium">Could not connect to lazyusage server</p>
            <p className="text-gray-500 text-sm">
              Make sure it's running: <code className="bg-gray-800 px-1.5 py-0.5 rounded">bun run lazyusage --serve --port {port}</code>
            </p>
          </div>
        )}

        {data && (
          <>
            {status === "error" && (
              <p className="mb-4 text-xs text-amber-400">Connection lost — showing last known data</p>
            )}
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {data.services.map((svc) => (
                <ServiceCard key={svc.name} service={svc} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
