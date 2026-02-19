import { useState, useEffect, useRef } from "react";
import type { UsageSnapshot } from "../types";

type Status = "connecting" | "connected" | "error" | "closed";

interface StreamState {
  data: UsageSnapshot | null;
  status: Status;
  error: string | null;
}

export function useUsageStream(port: number): StreamState {
  const [state, setState] = useState<StreamState>({
    data: null,
    status: "connecting",
    error: null,
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `http://localhost:${port}/stream`;

    function connect() {
      setState((s) => ({ ...s, status: "connecting", error: null }));
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setState((s) => ({ ...s, status: "connected", error: null }));
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as UsageSnapshot;
          setState({ data: parsed, status: "connected", error: null });
        } catch {
          // skip malformed events
        }
      };

      es.onerror = () => {
        // Preserve last known data; EventSource auto-reconnects unless we close it
        setState((s) => ({
          ...s,
          status: "error",
          error: `Cannot connect to lazyusage server on port ${port}`,
        }));
      };
    }

    connect();

    return () => {
      esRef.current?.close();
    };
  }, [port]);

  return state;
}
