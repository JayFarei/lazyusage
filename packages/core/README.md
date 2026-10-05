# lazyusage-core

Core collectors, fallback chains, formatters, and storage used by `lazyusage`.

## Install

```bash
bun add lazyusage-core
```

## What it exports

- collector and fallback-chain helpers
- JSON and text formatters
- parser types for local session ledgers
- SQLite-backed snapshot storage
- shared types for service/resource metadata
- the service registry (`SERVICES`, `SERVICE_NAMES`): Claude, Codex and Grok

For the end-user CLI, install `lazyusage`.
