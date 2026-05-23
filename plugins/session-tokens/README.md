# @streetturtle/opencode-session-tokens

OpenCode sidebar plugin for session token usage in the current session.

- Collapsed: `▶ Session Tokens <total>`
- Expanded: `▼ Session Tokens <total>` with per-model breakdown
- Total uses session token counters when available
- Breakdown aggregates assistant response spend (`input + output + reasoning + cache.write`)

## Install

```sh
opencode plugin @streetturtle/opencode-session-tokens
```

Global install:

```sh
opencode plugin --global @streetturtle/opencode-session-tokens
```
