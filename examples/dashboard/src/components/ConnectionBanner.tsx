interface Props {
  status: "connecting" | "connected" | "error" | "closed";
  error: string | null;
  port: number;
  onPortChange: (port: number) => void;
}

const statusConfig = {
  connecting: { color: "bg-amber-500", label: "Connecting..." },
  connected: { color: "bg-green-500", label: "Connected" },
  error: { color: "bg-red-500", label: "Error" },
  closed: { color: "bg-gray-500", label: "Closed" },
};

export function ConnectionBanner({ status, error, port, onPortChange }: Props) {
  const cfg = statusConfig[status];

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-900 border-b border-gray-800 text-sm">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.color}`} />
      <span className="text-gray-300">{cfg.label}</span>
      {error && <span className="text-red-400 flex-1 truncate">{error}</span>}
      <div className="ml-auto flex items-center gap-2 text-gray-400">
        <label htmlFor="port-input">Port:</label>
        <input
          id="port-input"
          type="number"
          value={port}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v > 0) onPortChange(v);
          }}
          className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-200 focus:outline-none focus:border-gray-500"
        />
      </div>
    </div>
  );
}
