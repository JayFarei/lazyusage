# TODOS

Public roadmap. Items deferred from the Predictive Capacity v1 review.

## v1.1 — Regime Engine + Calendar TUI

- [ ] Regime engine: quartile-based detection, 4-regime classification (deferred: validate linear accuracy first)
- [ ] Exponential decay weighted average for "expected" scenario (deferred: linear extrapolation sufficient for v1)
- [ ] Calendar TUI overlay: fullscreen 2-week planner (deferred: validate supervised marks via CLI first)
- [ ] Keybinding for calendar overlay: reassign from `p` to `c` (deferred: calendar itself deferred)
- [ ] Day-of-week awareness for regime detection: weekday vs weekend split (Open Q1)
- [ ] `regimes.ts` and `weights.ts` modules (deferred: part of regime engine)

## v2 — Daemon + Multi-Agent

- [ ] Always-on collector daemon (`lazyusage daemon start/stop/status/logs`)
- [ ] launchd plist for macOS, systemd unit for Linux (Open Q4)
- [ ] Daemon/TUI coexistence: daemon owns collection, TUI reads via HTTP (Open Q5)
- [ ] Multi-agent reservation/lease system (deferred: race condition is real, single-agent in v1)
- [ ] Divergence alerts: warn when actual usage diverges from prediction mid-week (Open Q3)
- [ ] Combined multi-service prediction view (Open Q2)
- [ ] `GET /prediction` endpoint and SSE stream prediction block

## Backlog

- [ ] Extend daily aggregate retention beyond 30 days (daily summaries are tiny)
- [ ] Backtest: compare prediction vs actual end-of-window outcome for accuracy validation
- [ ] Success metrics: prediction within +/-10% of actual 70% of the time
- [ ] Regime variance check: collapse to single "steady" regime when IQR < threshold
