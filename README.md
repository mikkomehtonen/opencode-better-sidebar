# opencode-better-sidebar

Small, focused OpenCode sidebar plugins that make daily coding sessions faster.

If this helps your workflow, please star the repo.

<p align="center">
  <img src="assets/screenshot.png" alt="opencode-better-sidebar screenshot" width="980" />
</p>

## Install

The 2.x line of every plugin in this repo targets OpenCode 2:

```sh
opencode plugin add @streetturtle/opencode-context-progress
opencode plugin add @streetturtle/opencode-open-in
opencode plugin add @streetturtle/opencode-recap
opencode plugin add @streetturtle/opencode-session-tokens
```

On OpenCode 1, install the `@1` versions instead (e.g.
`opencode plugin --global @streetturtle/opencode-session-tokens@1`).

## Plugin Pack

- [`@streetturtle/opencode-open-in`](./plugins/open-in) - quick buttons to open the current session folder in Zed, VS Code, or Cursor. (2.x = OpenCode 2)
- [`@streetturtle/opencode-context-progress`](./plugins/context-progress) - context usage progress bar with token usage, window limit, and spend. (2.x = OpenCode 2)
- [`@streetturtle/opencode-recap`](./plugins/recap) - one-click AI recap for the current session. (2.x = OpenCode 2)
- [`@streetturtle/opencode-session-tokens`](./plugins/session-tokens) - collapsible session token totals with per-model breakdown. (2.x = OpenCode 2)
