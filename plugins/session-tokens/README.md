# @streetturtle/opencode-session-tokens

OpenCode sidebar plugin for quick session token visibility.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/session-tokens-screenshot.png" alt="Session Tokens sidebar screenshot" width="520" />

## What it shows

- Collapsed: `▶ Session Tokens <total> (<$cost>)` when cost data is available
- Expanded: `▼ Session Tokens <total> (<$cost>)` with per-model totals
- Falls back to session-level token counters when per-message breakdown is unavailable

## Cost logic

- Uses assistant message `cost` values when available
- Falls back to session-level `cost` when per-message costs are unavailable

## Counting logic

- Per-message spend uses: `input + output + reasoning + cache.write`
- Counts assistant messages with token data
- De-duplicates repeated assistant messages by message ID

## Install

```sh
opencode plugin @streetturtle/opencode-session-tokens
```

Global install:

```sh
opencode plugin --global @streetturtle/opencode-session-tokens
```
