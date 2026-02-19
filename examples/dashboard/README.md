# lazyusage dashboard (example)

A React + Vite proof-of-concept that consumes the lazyusage HTTP API.

## Quick start

```bash
# 1. Start the server (from repo root)
bun run lazyusage --serve --port 8080

# 2. Run the dashboard
cd examples/dashboard
npm install
npm run dev
# Visit http://localhost:5173
```

## Configuration

Port can be changed via query param: `http://localhost:5173?port=3000`
