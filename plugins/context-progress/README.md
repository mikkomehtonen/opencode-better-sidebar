# @streetturtle/opencode-context-progress

Compact context usage widget for the OpenCode sidebar.

<img src="https://raw.githubusercontent.com/streetturtle/opencode-better-sidebar/main/assets/context-progress-screenshot.png" alt="Context Progress sidebar screenshot" width="520" />

## What it shows

- **Line 1:** context progress bar + percentage used
- **Line 2:** consumed tokens / model context window / session cost

## How it works

- Uses the latest assistant response with token data
- Token count formula: `input + output + reasoning + cache.read + cache.write`
- Context window is read from the active provider/model metadata
- Bar color changes with usage:
  - normal: `< 70%`
  - warning: `>= 70%`
  - danger: `>= 90%`

## Install

Requires OpenCode 2 (for OpenCode 1 install version `@1`).

```sh
opencode plugin add @streetturtle/opencode-context-progress
```

This installs the plugin and adds it to your global configuration
(`~/.config/opencode/cli.json`).

## Replace the built-in context section

OpenCode 2 shows its own context section in the sidebar. To hide it and keep only this
widget, add a disable directive **before** the plugin entry in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["-opencode.sidebar.context", "@streetturtle/opencode-context-progress"]
}
```

