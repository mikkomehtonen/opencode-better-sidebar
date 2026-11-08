# @streetturtle/opencode-session-tokens

OpenCode sidebar plugin for quick session token visibility.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/session-tokens-screenshot.png" alt="Session Tokens sidebar screenshot" width="520" />

## What it shows

- Collapsed: `▶ Session Tokens <total> (<$cost>)` when cost data is available
- Expanded: `▼ Session Tokens <total> (<$cost>)` with per-model totals for the main agent
- When subagents were used, the total includes their usage and a `Subagents` section splits out per-subagent-agent totals
- Falls back to session-level token counters when per-message breakdown is unavailable

## Install

Requires OpenCode 2 (for OpenCode 1 install version `@1`).

```sh
opencode plugin add @streetturtle/opencode-session-tokens
```

This installs the plugin and adds it to your global configuration
(`~/.config/opencode/cli.json`).

## Subagent usage

- Subagent turns run in separate child sessions, so their spend is not part of the parent session's aggregate counters
- The plugin discovers descendant sessions by parent id and adds every subagent's cumulative `tokens`/`cost`
- Only descendants launched as subagents count (children with an `agent`), so forked sessions are excluded
- The child tree recurses through nested subagents, matching your `subagent_depth` setting
- Totals update live while subagents run, and historical subagent usage is restored when you reopen a session

## Cost logic

- Uses assistant message `cost` values when available
- Falls back to session-level `cost` when per-message costs are unavailable
- Subagent sessions use the child session's aggregate `cost`

## Counting logic

- Per-message spend uses: `input + output + reasoning + cache.write`
- Counts assistant messages with token data
- De-duplicates repeated assistant messages by message ID
- Subagent spend uses each child session's cumulative `tokens` (input + output + reasoning + cache.write)
