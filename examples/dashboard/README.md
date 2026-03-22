# lazyusage dashboard example

React + Vite example that consumes the local `lazyusage` HTTP/SSE server.

## Quick start

```bash
# Terminal 1
bunx @lazyusage/cli --serve --port 8080

# Terminal 2
cd examples/dashboard
npm install
npm run dev
```

Open `http://localhost:5173`.

## Notes

- The dashboard expects a local `lazyusage` server and defaults to port `8080`.
- Change the API port with `?port=3000`.
- For repo-local development, `bun run lazyusage --serve --port 8080` works after `bun run build`.
