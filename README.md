# opencode-better-sidebar

Collection of OpenCode sidebar plugins.

## Plugins

- `@streetturtle/opencode-open-in` - quick buttons to open the current session folder in your IDE.
- `@streetturtle/opencode-context-progress` - context usage progress bar with tokens, limit, and spend.
- `@streetturtle/opencode-recap` - session recap summary in the sidebar.
- `@streetturtle/opencode-session-switcher` - quick sidebar list to jump between sessions.
- `@streetturtle/opencode-session-tokens` - collapsible session tokens and per-model token breakdown.

## Publishing

This repo publishes each plugin as its own npm package via GitHub Actions.

Required GitHub secret:

- `NPM_TOKEN` (npm automation token with publish access to `@streetturtle/*`)

Security notes:

- Use an npm automation token scoped only to publish `@streetturtle/opencode-*`
- Enable npm 2FA for account settings and token creation
- Workflow publishes only packages named `@streetturtle/opencode-*`
