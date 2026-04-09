# Claude Code Monitoring Usage: R&D Scouting Brief

> Research date: 2026-03-27
> Source: https://code.claude.com/docs/en/monitoring-usage
> Category: platform feature (observability)

---

## Overview

Claude Code ships a built-in OpenTelemetry (OTel) integration that exports usage metrics (tokens, cost, sessions, LOC, commits, PRs) and granular events (prompts, tool calls, API requests) to any OTel-compatible backend. Anthropic also provides three server-side APIs for organizational analytics: a Usage & Cost Admin API, a Cost Report API, and a Claude Code Analytics API. The OTel path is self-service and works on any plan; the Admin APIs require an organization with an Admin API key.

## Problem It Solves

Organizations need visibility into Claude Code usage patterns, cost attribution, and developer productivity. Individual developers want to track their own token consumption and capacity remaining. The OTel integration solves the former; `/cost` and `/stats` solve the latter at the session level.

## How It Works

### Architecture: Two Distinct Paths

**Path 1: OpenTelemetry (client-side, any plan)**

Claude Code embeds an OTel SDK. When `CLAUDE_CODE_ENABLE_TELEMETRY=1`, it exports:
- **Metrics** via `otlp`, `prometheus`, or `console` exporter
- **Events/Logs** via `otlp` or `console` exporter

Data flows: Claude Code process -> OTel SDK -> configured exporter -> your backend (Prometheus, Datadog, Honeycomb, Grafana, etc.)

Default intervals: metrics every 60s, logs every 5s. Configurable via `OTEL_METRIC_EXPORT_INTERVAL` and `OTEL_LOGS_EXPORT_INTERVAL`.

**Path 2: Admin APIs (server-side, organization-only)**

Three endpoints, all requiring `sk-ant-admin...` keys:

| Endpoint | Granularity | Data |
|----------|-------------|------|
| `/v1/organizations/usage_report/messages` | 1m / 1h / 1d buckets | Token counts by model, workspace, service tier |
| `/v1/organizations/cost_report` | 1d only | Cost in USD by workspace, description |
| `/v1/organizations/usage_report/claude_code` | Daily aggregated | Per-user: sessions, LOC, commits, PRs, tool accept/reject, model breakdown with estimated cost |

### Key Concepts

- **OTel Meter Name**: `com.anthropic.claude_code`
- **Service Name**: `claude-code`
- **Metrics Temporality**: `delta` by default, configurable to `cumulative`
- **Cardinality Control**: `session.id`, `app.version`, `account_uuid` can be toggled off
- **Event Correlation**: `prompt.id` (UUID v4) links all events from a single user prompt
- **Dynamic Headers**: `otelHeadersHelper` script for enterprise token rotation (29-min refresh)

### Core Metrics

| Metric | Unit | Extra Attributes |
|--------|------|------------------|
| `claude_code.session.count` | count | — |
| `claude_code.lines_of_code.count` | count | `type` (added/removed) |
| `claude_code.pull_request.count` | count | — |
| `claude_code.commit.count` | count | — |
| `claude_code.cost.usage` | USD | `model` |
| `claude_code.token.usage` | tokens | `type` (input/output/cacheRead/cacheCreation), `model` |
| `claude_code.code_edit_tool.decision` | count | `tool_name`, `decision`, `source`, `language` |
| `claude_code.active_time.total` | seconds | `type` (user/cli) |

### Events (via OTel Logs)

| Event | Key Attributes |
|-------|---------------|
| `claude_code.user_prompt` | `prompt_length`, optional `prompt` content |
| `claude_code.tool_result` | `tool_name`, `success`, `duration_ms`, `decision_type`, `tool_result_size_bytes` |
| `claude_code.api_request` | `model`, `cost_usd`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_*_tokens`, `speed` |
| `claude_code.api_error` | `model`, `error`, `status_code`, `attempt`, `speed` |
| `claude_code.tool_decision` | `tool_name`, `decision`, `source` |

### Standard Attributes (on all signals)

`session.id`, `app.version`, `organization.id`, `user.account_uuid`, `user.account_id`, `user.id` (device), `user.email`, `terminal.type`

### Resource Attributes

`service.name`, `service.version`, `os.type`, `os.version`, `host.arch`, `wsl.version`

## Plan Availability — THE KEY QUESTION

| Feature | Individual (Pro/Max) | API (PAYG) | Teams | Enterprise |
|---------|---------------------|------------|-------|------------|
| **OTel telemetry** (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) | YES | YES | YES | YES |
| **`/cost` command** (session tokens) | Shows note: "subscription includes usage" | YES (full detail) | YES | YES |
| **`/stats` command** (usage patterns) | YES | N/A | YES | YES |
| **Admin Usage API** (`/v1/organizations/usage_report/messages`) | NO (requires org) | YES (with admin key) | YES | YES |
| **Admin Cost API** (`/v1/organizations/cost_report`) | NO (requires org) | YES | YES | YES |
| **Claude Code Analytics API** (`/v1/organizations/usage_report/claude_code`) | NO (requires org) | YES | YES | YES |
| **Console analytics dashboard** | NO | YES | YES | YES |
| **Managed settings (MDM)** | N/A | N/A | YES | YES |
| **Local JSONL session files** (`~/.claude/projects/**/*.jsonl`) | YES | YES | YES | YES |
| **Local credentials file** (`~/.claude/.credentials.json`) | YES | YES | YES | YES |

**Bottom line: OTel telemetry and local JSONL files work on ALL plans, including individual Pro/Max. The Admin APIs are organization-only.**

## Maturity & Traction

- **License**: Proprietary (Anthropic product feature)
- **Backing**: Anthropic (1st party)
- **Production Users**: Referenced by "several large enterprises" using LiteLLM for Bedrock/Vertex cost tracking
- **Ecosystem**: Partner integrations with CloudZero, Datadog, Grafana Cloud, Honeycomb, Vantage
- **ROI Guide**: Official GitHub repo at `anthropics/claude-code-monitoring-guide` with Docker Compose + Prometheus configs
- **Community Tools**: `ccusage` (npm), ClawPort dashboard, Claude-Code-Usage-Monitor

## Strengths

- OTel is industry-standard, works with any backend, zero vendor lock-in
- Rich event model: prompt-level correlation via `prompt.id`, tool timing, error tracking
- Cardinality controls prevent metric explosion in large orgs
- Dynamic header helper for enterprise token rotation
- Analytics API provides per-user productivity metrics (LOC, commits, PRs, tool acceptance rates)
- OTel path works on individual plans, no org required
- Local JSONL files provide raw per-message token data on every plan

## Limitations & Risks

- **Admin APIs are org-only**: Individual Pro/Max users cannot access server-side usage/cost APIs. The docs explicitly state: "The Admin API is unavailable for individual accounts."
- **OTel cost metric is approximate**: "For official billing data, refer to your API provider"
- **No built-in capacity/rate-limit metrics**: OTel exports tokens used and cost but NOT remaining capacity, rate limit headroom, or reset times. The `api.anthropic.com/api/oauth/usage` endpoint (which lazyusage uses) is undocumented and not part of this system.
- **No JSONL schema guarantee**: Local session files are undocumented, format may change
- **Subscription plans get limited `/cost`**: Pro/Max users see "no need to monitor cost" message instead of full token breakdown
- **Daily-only Analytics API**: Claude Code Analytics is daily aggregated, 1-hour delay, no real-time
- **1P only**: Usage on Bedrock, Vertex, Foundry not tracked by these APIs

## Competitive Landscape

| Alternative | Differentiator | Trade-off |
|-------------|---------------|-----------|
| **lazyusage** (this project) | Real-time capacity tracking via undocumented OAuth usage API + JSONL parsing | Depends on undocumented API, no OTel |
| **ccusage** (npm) | Aggregates local JSONL files into reports | No real-time, no API data |
| **ClawPort** | Web dashboard with 5-hour rolling window | Heavier setup, web-based |
| **LiteLLM proxy** | Works with Bedrock/Vertex, tracks spend by key | Requires proxy layer, unaudited security |
| **Native OTel** (this feature) | Official, rich metrics+events, any backend | No capacity remaining, no reset times |

## Community Signal

- The `anthropics/claude-code-monitoring-guide` repo on GitHub provides ready-to-use Docker Compose setups
- Multiple blog posts (Shipyard, ClawPort, AI Engineering Report) document workarounds for individual plan tracking
- Common complaint: per-session `/cost` data is ephemeral, no historical view for individual users
- `ccusage` has traction as the go-to community tool for local JSONL analysis

---

## Integration Analysis: lazyusage

### Fit Assessment: **Moderate Fit** — complements but does not replace

The OTel integration provides rich data that lazyusage currently lacks (cost, LOC, commits, tool decisions, active time). However, it does NOT provide the core data lazyusage is built around: **real-time capacity remaining and rate limit headroom with reset times**.

### What lazyusage already has that OTel doesn't

| lazyusage data | Source | OTel equivalent |
|----------------|--------|-----------------|
| `five_hour` utilization % | `api.anthropic.com/api/oauth/usage` | NONE |
| `seven_day` utilization % | same | NONE |
| `seven_day_sonnet` utilization | same | NONE |
| Reset times | same | NONE |
| Capacity remaining (computed) | time elapsed - allowance used | NONE |
| Per-project token breakdown | JSONL parsing | NONE (no project-level grouping) |

### What OTel adds that lazyusage doesn't have

| OTel data | Metric/Event | Value for lazyusage |
|-----------|-------------|---------------------|
| Cost per request (USD) | `claude_code.cost.usage` | Could show $ spent in TUI |
| Token breakdown by type | `claude_code.token.usage` with input/output/cache | Richer than raw JSONL parsing |
| Active time | `claude_code.active_time.total` | Productivity insight |
| LOC added/removed | `claude_code.lines_of_code.count` | Productivity insight |
| Tool accept/reject rates | `claude_code.code_edit_tool.decision` | Workflow insight |
| API request latency | `claude_code.api_request` event `duration_ms` | Performance insight |
| Model used per request | `model` attribute | Multi-model tracking |
| Commits/PRs created | counters | Git productivity |

### Concrete Integration Patterns

**Pattern A: Prometheus scrape (recommended for individual users)**

1. User sets `OTEL_METRICS_EXPORTER=prometheus` + `CLAUDE_CODE_ENABLE_TELEMETRY=1`
2. Claude Code exposes a Prometheus metrics endpoint locally
3. lazyusage scrapes that endpoint alongside its existing data sources
4. New TUI tab/panel shows cost, tokens by type, active time
5. **Works on ALL plans including Pro/Max**

**Pattern B: OTLP receiver (self-hosted)**

1. lazyusage bundles a lightweight OTLP gRPC/HTTP receiver
2. User points `OTEL_EXPORTER_OTLP_ENDPOINT` at lazyusage's receiver
3. lazyusage ingests metrics + events into its SQLite `UsageStore`
4. Enables historical cost tracking, tool usage trends, per-session breakdowns
5. **Works on ALL plans**

**Pattern C: Console exporter file capture**

1. User sets `OTEL_METRICS_EXPORTER=console`
2. lazyusage tails the console output (or redirects to a file)
3. Simplest integration but least structured
4. **Works on ALL plans**

**Pattern D: Admin API integration (org users only)**

1. If user has admin key, lazyusage can pull from `/v1/organizations/usage_report/claude_code`
2. Show per-user productivity metrics in a new panel
3. **Teams/Enterprise/API-PAYG only**

### Effort Estimate

| Pattern | Effort | Complexity |
|---------|--------|------------|
| A (Prometheus scrape) | Short (2-3 days) | Low, just HTTP GET + parse Prometheus text format |
| B (OTLP receiver) | Medium (1-2 weeks) | Moderate, need gRPC/HTTP server + OTel proto parsing |
| C (Console file tail) | Quick (hours) | Low but fragile |
| D (Admin API) | Short (2-3 days) | Low, REST API with pagination |

### Recommended Approach

**Pattern A first**: Add Prometheus scrape as an optional data source in `PersistentFallbackChain`. This:
- Works on ALL plans (including your individual Pro/Max)
- Doesn't replace existing capacity tracking (the core value prop)
- Adds cost, token breakdown, active time, LOC, tool decisions
- Requires only that the user set 2 env vars
- No new dependencies (Prometheus text format is trivial to parse)

Then optionally add Pattern D for org users who want the productivity dashboard.

### Open Questions

1. **Prometheus endpoint port**: When `OTEL_METRICS_EXPORTER=prometheus`, what port does Claude Code listen on? (Likely 9464 default, needs verification)
2. **Metric reset behavior**: Are OTel counters cumulative or delta? (Default is delta, configurable)
3. **Will `api.anthropic.com/api/oauth/usage` be deprecated?** The OTel system doesn't expose capacity remaining, so if the undocumented OAuth usage endpoint goes away, lazyusage loses its core data source with no OTel replacement
4. **Console exporter format**: Is it machine-parseable JSON or human-readable text?

## Key Takeaways

1. **OTel telemetry works on ALL plans including individual Pro/Max** — this is NOT teams-only. You can integrate it today.
2. **It does NOT replace lazyusage's core value**: OTel has no capacity remaining, no rate limit headroom, no reset times. The undocumented `oauth/usage` endpoint remains the only source for that data.
3. **Best integration path**: Add optional Prometheus scrape to surface cost, token type breakdown, active time, and productivity metrics alongside the existing capacity dashboard. Two env vars for the user, ~2-3 days of work.

## Sources

- [Claude Code Monitoring Usage (official docs)](https://code.claude.com/docs/en/monitoring-usage)
- [Manage costs effectively (official docs)](https://code.claude.com/docs/en/costs)
- [Usage and Cost API (platform docs)](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api)
- [Claude Code Analytics API (platform docs)](https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api)
- [Claude Code ROI Measurement Guide (GitHub)](https://github.com/anthropics/claude-code-monitoring-guide)
- [How to track Claude Code usage (Shipyard)](https://shipyard.build/blog/claude-code-track-usage/)
- [Monitor Claude Code usage and costs (ClawPort)](https://www.clawport.dev/blog/monitor-claude-code-usage-costs)
- [Claude Code Limits Guide (TrueFoundry)](https://www.truefoundry.com/blog/claude-code-limits-explained)
- [Claude plans comparison (SSD Nodes)](https://www.ssdnodes.com/blog/claude-code-pricing-in-2026-every-plan-explained-pro-max-api-teams/)
