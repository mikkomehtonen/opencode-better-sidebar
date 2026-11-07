# opencode-better-sidebar

Small, focused OpenCode sidebar plugins that make daily coding sessions faster.

If this helps your workflow, please star the repo.

<p align="center">
  <img src="assets/screenshot.png" alt="opencode-better-sidebar screenshot" width="980" />
</p>

## Install

[`@streetturtle/opencode-context-progress`](./plugins/context-progress) 2.x targets OpenCode 2:

```sh
opencode plugin add @streetturtle/opencode-context-progress
```

The other plugins in this repo are still OpenCode 1 plugins (use `@streetturtle/opencode-context-progress@1` for `context-progress` on OpenCode 1):

```sh
opencode plugin --global @streetturtle/opencode-open-in
opencode plugin --global @streetturtle/opencode-recap
opencode plugin --global @streetturtle/opencode-session-tokens
```

or from OpenCode, press <kbd>ctrl</kbd>+<kbd>p</kbd> -> "Install Plugin" -> "@streetturtle/opencode-open-in"

## Plugin Pack

- [`@streetturtle/opencode-open-in`](./plugins/open-in) - quick buttons to open the current session folder in Zed, VS Code, or Cursor.
- [`@streetturtle/opencode-context-progress`](./plugins/context-progress) - context usage progress bar with token usage, window limit, and spend. (2.x = OpenCode 2)
- [`@streetturtle/opencode-recap`](./plugins/recap) - one-click AI recap for the current session.
- [`@streetturtle/opencode-session-tokens`](./plugins/session-tokens) - collapsible session token totals with per-model breakdown.
