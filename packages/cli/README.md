# @lazyusage/cli

CLI package for monitoring Claude CLI and Codex CLI usage.

## Install

```bash
bunx @lazyusage/cli --help
```

or:

```bash
bun add -g @lazyusage/cli
lazyusage --help
```

## Common commands

```bash
lazyusage
lazyusage --json
lazyusage --capacity
lazyusage usage-check --json
lazyusage --serve --port 3000
```

The server is intended for local integrations and binds to `127.0.0.1` by default.

Project docs and agent skill:

- Root README: `https://github.com/jayfarei/lazyusage#readme`
- Skill: `https://github.com/jayfarei/lazyusage/blob/main/skills/lazyusage/SKILL.md`
