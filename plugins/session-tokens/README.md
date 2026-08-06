# @streetturtle/opencode-session-tokens

OpenCode sidebar plugin for quick session token visibility.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/session-tokens-screenshot.png" alt="Session Tokens sidebar screenshot" width="520" />

## What it shows

- Collapsed: `▶ Session Tokens <total> (<$cost>)` when cost data is available
- Expanded: `▼ Session Tokens <total> (<$cost>)` with per-model totals for the main agent
- When subagents were used, the total includes their usage and a `Subagents` section splits out per-subagent-agent totals
- Falls back to session-level token counters when per-message breakdown is unavailable

## Subagent usage

- Subagent turns run in separate child sessions, so their spend is not part of the parent session's aggregate counters
- The plugin fetches the child session tree via `session.children` and adds every descendant's cumulative `tokens`/`cost`
- Only descendants launched as subagents count (children with an `agent`), so forked sessions are excluded
- The child tree recurses through nested subagents, matching your `subagent_depth` setting
- Data refreshes as subagent activity is streamed back (message/status events); on older OpenCode versions without the `children` endpoint this feature degrades silently to main-agent-only totals

## Cost logic

- Uses assistant message `cost` values when available
- Falls back to session-level `cost` when per-message costs are unavailable
- Subagent sessions use the child session's aggregate `cost`

## Counting logic

- Per-message spend uses: `input + output + reasoning + cache.write`
- Counts assistant messages with token data
- De-duplicates repeated assistant messages by message ID
- Subagent spend uses each child session's cumulative `tokens` (input + output + reasoning + cache.write)

## Install

```sh
opencode plugin @streetturtle/opencode-session-tokens
```

Global install:

```sh
opencode plugin --global @streetturtle/opencode-session-tokens
```
