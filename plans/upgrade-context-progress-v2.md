# Upgrade `context-progress` plugin from OpenCode V1 to V2 (pilot port)

## Objective and requirements

The repo `/app` (`opencode-better-sidebar`, npm-workspaces monorepo, `plugins/*`) contains 4
OpenCode **V1** TUI plugins. We are upgrading them to **OpenCode V2 one plugin at a time**,
starting with `plugins/context-progress` as the pilot that establishes the migration pattern.

Requirements (agreed with the user):

1. **V2-only**: the ported plugin must NOT keep V1 compatibility. No hybrid `server()`/`tui()`
   default export. V1 users keep the old published package versions.
2. Port `plugins/context-progress` so it loads and behaves equivalently in OpenCode V2's TUI:
   a sidebar "Context" widget showing a context-usage progress bar, percentage, and a detail
   line of `tokens / contextWindow / sessionCost`.
3. Keep the monorepo layout, package name, `./tui` export, and the simple
   `cp index.ts dist/tui.tsx` build approach.
4. Do NOT touch the other three plugins (`open-in`, `recap`, `session-tokens`) — they are
   migrated later, one at a time, reusing the pattern proven here.

Authoritative documentation used for this plan (all fetched 2026-11-07):

- V2 plugins migration guide: <https://opencode.ai/docs/build/plugins/migrate-v1>
- V2 TUI plugin guide: <https://opencode.ai/docs/build/plugins/cli>
- V1→V2 overall migration guide: <https://opencode.ai/docs/migrate-v1>

Key doc facts: V1 plugin implementations do not run at all in V2; the plugin package renames
from `@opencode-ai/plugin` to **`@opencode/plugin`**; V2 plugins default-export
`Plugin.define({ id, setup(ctx) })`; OpenCode resolves the bare `@opencode/plugin/tui` import
at runtime; JSX plugins add OpenTUI ≥ 0.6 + solid-js as **peer** dependencies.

## Relevant existing architecture

Facts verified in the repo:

- Root `package.json`: private, `"workspaces": ["plugins/*"]`, scripts
  `build` = `npm run build --workspaces --if-present`, `pack:dry` likewise.
- `plugins/context-progress/index.ts` (137 lines) — plain ESM TSX via pragma
  `/** @jsxImportSource @opentui/solid */`. Current V1 API usage (exact):
  - `import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"`
  - `import { TextAttributes } from "@opentui/core"`, `createMemo` from `solid-js`
  - `const main: TuiPlugin = async (api) => { api.slots.register({ order: 100, slots: {
    sidebar_content(_ctx, props) { return <View api={api} sessionID={props.session_id} /> } } }) }`
  - `export default { id: "streetturtle.context-progress", tui: main }`
  - `api.state.session.messages(sessionID)` — cached message list, read inside `createMemo`
  - `api.state.session.get(sessionID)` — probed for a session-level `cost`
  - `api.state.provider.find(item => item.id === providerID)?.models?.[modelID]?.limit?.context`
    — context window size
  - `api.theme.current` — used tokens: `.text`, `.textMuted`, `.accent`, `.error`, `.warning`
  - Message fields read (defensively, with `?.` and multiple fallbacks):
    `role` / `info.role`, `tokens.input|output|reasoning|cache.read|cache.write`,
    `providerID` / `info.providerID`, `modelID` / `info.modelID`, `cost` / `info.cost` /
    `usage.cost` / `metrics.cost`
  - Widget: bar width 24 (`█`/`░`), colors: `>= 90%` error, `>= 70%` warning, else accent;
    detail line `tokens / contextWindow / $cost` via `Intl.NumberFormat("en-US")`.
- `plugins/context-progress/package.json`: name `@streetturtle/opencode-context-progress`,
  version `1.0.1`, `type: module`, `exports: { "./tui": "./dist/tui.tsx" }`, `files: [dist, README.md]`,
  build script `rm -rf dist && mkdir -p dist && cp index.ts dist/tui.tsx`,
  `engines: { "opencode": ">=1.4.3" }`, dependencies:
  `@opencode-ai/plugin ^1.4.3`, `@opentui/core ^0.2.2`, `@opentui/solid ^0.2.2`, `solid-js ^1.9.12`.
- No tsconfig, no bundler, no tests anywhere in the repo. No `opencode.json` / `cli.json` in the repo.
- The other plugins use the same V1 `slots.register({ ..., sidebar_content })` pattern, so
  decisions here (theme lookup helper, slot registration, package.json shape) become the template.

## V1 → V2 API mapping (what changes in this port)

| V1 usage in `context-progress` | V2 equivalent (from official V2 TUI guide) |
|---|---|
| `import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"` | `import { Plugin, usePlugin } from "@opencode/plugin/tui"`; context/props types from `@opencode/plugin/tui/context` (exact type names — verify in shipped `.d.ts`) |
| `export default { id: "…", tui: main }` | `export default Plugin.define({ id: "streetturtle.context-progress", setup(context) { … } })` |
| `api.slots.register({ order: 100, slots: { sidebar_content(_ctx, props) } })` | `context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <View sessionID={sessionID} /> })` — returns an unregister fn; **V2 has no numeric `order`**, ordering comes from placement (`append`) |
| `props.session_id` from slot ctx | `render: ({ sessionID }) => …` (camelCase, provided by the slot) |
| `api.state.session.messages(id)` | `context.data.session.message.list(sessionID)` (reactive inside a Solid computation); prime the cache with `await context.data.session.message.sync(sessionID)` |
| `api.state.session.get(id)` + probed `cost` fields | `context.data.session.get(sessionID)` and the dedicated **`context.data.session.cost(sessionID)`** (return shape — verify in types; keep message-summing fallback like V1 does) |
| `api.state.provider.find(…)?.models?.[modelID]?.limit?.context` | location data catalogs: `context.data.location.model.sync(location)` + `context.data.location.model.list(location)` (find the entry matching the session's provider/model; context-limit field name — verify in types). `location = context.location ?? context.data.location.default()` |
| `api.theme.current` (`.text`, `.textMuted`, `.accent`, `.error`, `.warning`) | `context.theme` semantic tokens (guide example: `context.theme.text.base`). Exact muted/accent/error/warning token paths — verify in types. Reactive when read inside a computation, so keep reads inside memos |
| (V1 pushed api object into JSX via props) | Inside JSX rendered by a slot, use `usePlugin()` from `@opencode/plugin/tui` to get the context instead of prop-drilling |
| cleanup | Return a cleanup function from `setup` (`context.ui.slot(...)` return value doubles as it) |
| deps `@opencode-ai/plugin` + `@opentui/*` + `solid-js` as `dependencies` | `dependencies: { "@opencode/plugin": "latest" }` + `peerDependencies: { "@opentui/core": ">=0.6.6", "@opentui/solid": ">=0.6.6", "solid-js": ">=1.9.0" }` (per V2 TUI guide "Publish and load") |

Unchanged in V2: `/** @jsxImportSource @opentui/solid */` pragma, `<box>/<text>` elements,
`TextAttributes` from `@opentui/core` (this plugin uses none of the OpenTUI 0.5→0.6 breaking
items — no `SyntaxStyle`, no `getLayoutNode`).

## Proposed implementation

### 1. Rewrite `plugins/context-progress/index.ts`

Pure formatting/helpers (`BAR_WIDTH`, `formatInt`, `formatMoney`, `safeNumber`, `readCost`,
`messageTokenCount`, `buildBar`) are copied over **unchanged** — they are API-independent.
Everything touching `api.*` is rewired:

- `View` no longer takes `api` as a prop; it calls `usePlugin()`.
- Inside `View`:
  - `createEffect(() => { void context.data.session.message.sync(props.sessionID) })` to prime
    the message cache on mount / session switch (cost/session entry: sync if the types show a
    `context.data.session.sync` is needed before `cost()`/`get()` are populated).
  - `messages` memo: `context.data.session.message.list(props.sessionID) ?? []`.
  - `sessionCost` memo: prefer `context.data.session.cost(sessionID)` (unwrap `.data`/number per
    verified shape); fall back to the existing sum-of-assistant-message-costs logic when it
    returns nothing — mirrors V1's defensive behavior.
  - `usage` memo: same algorithm (last assistant message with `output > 0`, token formula,
    percent of context window). Context window now resolves from the model catalog:
    `context.data.location.model.list(location)` entry matching the message's provider/model
    IDs, reading its context-limit field (verify name; V1 used `limit.context`).
  - `theme` reads stay inside memos, retargeted to `context.theme.<verified paths>`.
- `setup(context)`:
  - `const stop = context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => <View sessionID={sessionID} /> })`
  - Optionally (only if live verification shows the cache does not self-update): add
    `const stopEvents = context.data.listen(({ details }) => { … invalidate messages/cost for
    the event's sessionID … })` — exact event detail shape and whether manual invalidation is
    needed MUST be determined in step 2/7 below. The V2 docs show caches refreshing via
    `sync`/`invalidate`; the typed-event helper is `context.data.on(type, cb)` /
    `context.data.listen(cb)`, both returning unsubscribe functions.
  - `return () => { stop(); stopEvents?.() }`.

Reference sketch (**illustrative — resolve every `// verify` against the installed types before
finalizing**):

```tsx
/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui" // verify export names
import { TextAttributes } from "@opentui/core"

// … helpers unchanged from V1 …

function View(props: { sessionID: string }) {
  const context = usePlugin() // verify: gives the TUI plugin context inside slot JSX

  createEffect(() => {
    void context.data.session.message.sync(props.sessionID)
  })

  const messages = createMemo(
    () => (context.data.session.message.list(props.sessionID) ?? []) as any[],
  )

  const sessionCost = createMemo(() => {
    const direct = context.data.session.cost(props.sessionID) // verify return shape
    // if direct resolves to a usable number > 0, use it; else fall back to
    // summing assistant-message costs exactly like the V1 implementation
    /* fallback identical to V1 */
  })

  const usage = createMemo(() => {
    /* identical algorithm to V1; model lookup replaced by: */
    const location = context.location ?? context.data.location.default()
    const models = context.data.location.model.list(location) ?? [] // verify shape
    const model = models.find(
      (m) => m.providerID === providerID && m.id === modelID, // verify field names
    )
    const contextWindow = safeNumber(model?.limit?.context) // verify field name
    /* … */
  })

  const theme = () => context.theme // verify token paths: text base / muted / accent / error / warning
  const progress = createMemo(() => {
    /* same thresholds: >=90 error, >=70 warning, else accent */
  })

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Context</text>
      <box flexDirection="row" gap={1}>
        <text fg={progress().color}>{progress().bar}</text>
        <text fg={progress().color}> {progress().percent}%</text>
      </box>
      <text fg={theme().text.muted}>{detailLine()}</text>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.context-progress",
  setup(context) {
    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <View sessionID={sessionID} />,
    })
    return () => stopSlot()
  },
})
```

Keep the plugin `id` **identical** to V1 (`streetturtle.context-progress`) so any user-facing
references stay stable.

### 2. Update `plugins/context-progress/package.json`

- `version`: `1.0.1` → `2.0.0` (breaking, V2-only).
- Remove dependency `@opencode-ai/plugin`; add `dependencies: { "@opencode/plugin": "latest" }`
  (or a pinned compatible version once known).
- Move `@opentui/core` / `@opentui/solid` / `solid-js` from `dependencies` to
  `peerDependencies` with `">=0.6.6"`, `">=0.6.6"`, `">=1.9.0"` per the V2 TUI guide.
  (npm ≥ 7 auto-installs peers, so workspace dev still resolves them.)
- `engines`: `{ "opencode": ">=2.0.0" }`.
- Keep `exports: { "./tui": "./dist/tui.tsx" }`, `files`, `scripts` (`cp`-based build), repo
  metadata, keywords unchanged.

### 3. Update `plugins/context-progress/README.md`

- Keep "What it shows" / "How it works" (behavior unchanged).
- Replace the V1 install snippet (`opencode plugin @streetturtle/…`) with the V2 install path.
  The fetched V2 TUI guide documents TUI-only packages as `cli.json` entries:
  ```json
  { "plugins": ["@streetturtle/opencode-context-progress"] }
  ```
  in `~/.config/opencode/cli.json`. **Before finalizing, check the V2 CLI's current plugin
  command** (`opencode plugins --help` or <https://opencode.ai/docs/cli/plugins> — that page
  was unreachable when this plan was written) and prefer the CLI command form if one exists.
- Add a line: requires OpenCode 2 (V1 versions remain available as `@1`).

### 4. Update root `README.md`

- In the overview/install sections, reflect the V2 install method for this plugin and add a
  short compatibility note (e.g. "`context-progress` ≥ 2.0 targets OpenCode V2; other plugins
  in this repo are still V1"). Do not change sections for the other three plugins.

### Files to modify

| File | Change |
|---|---|
| `plugins/context-progress/index.ts` | Rewrite to V2 `Plugin.define` API (helpers kept) |
| `plugins/context-progress/package.json` | v2.0.0, `@opencode/plugin` dep, OpenTUI peers, engines |
| `plugins/context-progress/README.md` | V2 install instructions + OpenCode-2 note |
| `README.md` (root) | Per-plugin compatibility note, updated install for this plugin |
| `package-lock.json` | Regenerated by `npm install` (dependency changes) |

Not modified: the other three plugins, root `package.json`, build scripts.

## Step-by-step implementation instructions

1. **Baseline**: `cd /app && npm install && npm run build` succeeds on the untouched repo.
   Record current widget behavior from the README (bar, %, tokens/window/$cost line).
2. **Install V2 plugin package and inventory the real types** (this resolves all `// verify`
   notes — do this before writing code):
   - `npm install @opencode/plugin@latest --workspace @streetturtle/opencode-context-progress`
   - `npm uninstall @opencode-ai/plugin --workspace @streetturtle/opencode-context-progress`
     (also remove `@opentui/*` + `solid-js` from `dependencies`; re-add as `peerDependencies`
     by editing package.json, then `npm install`).
   - Open `node_modules/@opencode/plugin/**/tui*/**/*.d.ts` (and `@opencode/client` types) and
     confirm, writing findings into the port's comments if useful:
     a. exported `Plugin` (and `Plugin.define`) shape and the setup-context type name;
     b. `usePlugin` export and the slot-render prop type for `sidebar.content`
        (`sessionID` property);
     c. `context.data.session.message.list/sync`, `context.data.session.cost` return types;
     d. message/part field names in V2: role, `tokens.{input,output,reasoning,cache.read,
        cache.write}`, provider/model IDs on the assistant message/info;
     e. `context.data.location.model.list()` entry shape: provider ID field, model ID field,
        context-window limit field;
     f. `context.theme` token paths for: default text, muted text, accent, warning, error;
     g. `context.data.listen`/`on` event detail shape and whether message updates require
        manual `invalidate` or the cache self-refreshes.
3. **Rewrite `index.ts`** per the mapping table + verified types. Keep behavior parity:
   24-char bar, `Intl.NumberFormat("en-US")`, `$x.xx`, thresholds 70/90, defensive zero
   fallbacks for missing data (never crash on an empty session).
4. **Update `package.json`** (step 2 of Proposed implementation).
5. **Build**: `npm run build` from `/app` (must still pass — it is a `cp`);
   `npm run pack:dry` and confirm the tarball contains `dist/tui.tsx` + `README.md`, with the
   new peer deps in `package.json`.
6. **Update READMEs** (plugin + root).
7. **Live verification** (requires a machine with OpenCode V2 + this workspace):
   create a scratch project, add to `~/.config/opencode/cli.json`:
   `"plugins": ["file:///app/plugins/context-progress"]` (or `opencode.json` `plugins` entry
   with a local directory path per the V2 config docs; a linked workspace package also works).
   Run through the checklist below.

## Tests and verification

The repo has **no automated tests**; verification is build + runtime checklist (the guide's
"Verify a ported plugin" steps adapted):

1. `npm run build` and `npm run pack:dry` clean at `/app`; `npm install` introduces no
   unresolved peer warnings for this workspace.
2. Plugin **id appears** in OpenCode V2's active plugin list (e.g. plugin list UI /
   `context.client.plugin.list({ location })` / startup logs).
3. Widget renders in the sidebar inside a session: "Context" title, 24-char bar, percentage,
   and `tokens / window / $cost` detail line — same look as the V1 screenshot in the README.
4. Reactive updates: send a prompt; after the assistant reply completes, token count,
   percentage, and cost update without restart. If they do not, wire
   `context.data.listen(...)` → `context.data.session.message.invalidate(sessionID)` (and
   `cost`/`session.invalidate` if exposed) for message/session events, and note the event
   names here for reuse by the remaining 3 plugins.
5. Empty session shows `0 / -- / $0.00` bar at 0% without errors; switching sessions in the
   TUI swaps the numbers to the focused session.
6. Color thresholds: bar goes warning at ≥70% and error at ≥90% (can be checked with a model
   override or by temporarily lowering the window source in a scratch build — do not commit).
7. Cleanup: disable/reload the plugin in the TUI; no crash, widget disappears (slot unregister
   + cleanup fn exercised).
8. Test the **packed** tarball (`npm pack` + install by path), not only the workspace-linked
   copy, per the official guide.

Log any newly-confirmed API facts (event names, token paths) back into this plan file or a
follow-up note — the next three plugin ports (open-in → recap → session-tokens) will reuse them.

## Verified API facts (resolved during implementation, 2026-11-07)

All resolved against the shipped `.d.ts` of `@opencode/plugin@2.2.6` (`dist/tui/*.d.ts`,
nested `@opencode/client` types) and `@opencode/theme@2.2.6` `dist/tui/types.d.ts`:

a. **Plugin shape**: `import { Plugin, usePlugin } from "@opencode/plugin/tui"`;
   `Plugin.define({ id, setup(context) })` where `setup` may return a sync/async cleanup fn.
   Setup-context type is exported as `Context` from `@opencode/plugin/tui/context`.
b. **Slot**: `context.ui.slot(claim) => () => void` (unregister). `SlotMap["sidebar.content"]`
   input is `{ sessionID: string }`; `usePlugin(): Context` works inside slot JSX.
c. **Data**: `data.session.message.list(id): SessionMessageInfo[]`, `.sync(id): Promise<void>`,
   `.invalidate(id)`; `data.session.cost(id): number` (plain number — `MoneyUSD = number`);
   `data.session.get(id): SessionInfo | undefined` (also carries `cost`);
   `data.session.sync(id): Promise<void>` exists.
d. **V2 message shape**: discriminator is `type` (not `role`): `"user" | "assistant" | …`.
   `SessionMessageAssistant` has `model: { id, providerID, variant? }`,
   `tokens?: { input, output, reasoning, cache: { read, write } }` (identical field names to
   V1), and `cost?: number` directly on the message.
e. **Model catalog**: `data.location.model.list(location): ModelInfo[] | undefined` with
   entries `{ providerID, modelID, limit: { context, output? }, … }` — match on
   `providerID + modelID`, read `limit.context`. `location = context.location ?? data.location.default()`.
f. **Theme** (`context.theme: ResolvedTheme` from `@opencode/theme/tui`, RGBA values, pass
   directly to `fg`): text `text.base`, muted `text.muted`, accent `hue.accent[500]`
   (`HueScale` steps 100–900), warning `text.feedback.warning.base`,
   error `text.feedback.error.base` (`FeedbackKind = "error" | "warning" | "success" | "info"`).
g. **Reactivity**: the solid data store is event-driven (`createData` in `@opencode/client`
   subscribes to `OpenCodeEvent`s), so memos reading `message.list` / `cost` refresh
   automatically — no manual `listen`+`invalidate` was required. Relevant event names for
   future plugins: `session.usage.updated`, `session.step.ended`, `session.idle`.
   **CORRECTION (recap port, 2026-11-07)**: `session.idle` (and `session.status`) are only in
   the type union — the 2.2.6 server never emits them. Use `session.execution.started` /
   `session.execution.succeeded` instead (see `plans/upgrade-recap-v2.md` fact s).
h. **Package facts**: `@opencode/plugin` latest is **2.2.6**; its OpenTUI peers require
   **`>=0.8.1`** (docs said `>=0.6.6` — outdated). Optional peers (vite/electron/@opencode/theme)
   are NOT auto-installed; `@opencode/theme` only needs to exist locally for `tsc` of
   `context.d.ts`. `solid-js` peer `>=1.9.0`; `@opentui/solid@0.8.3`'s `babel-preset-solid`
   peer-needs `^1.9.16`, so regenerate stale lockfiles rather than pinning 1.9.12.
i. **CLI**: V2 has first-class plugin commands — `opencode plugin add|list|remove|check|update`
   (`add` = "Install a plugin and add it to the global configuration"). `cli.json` `plugins`
   accepts strings or `{ package, options }`; local directory paths work (used for live test:
   `"plugins": ["/app/plugins/context-progress"]`).
j. **Repo quirk**: source stays `index.ts` (no JSX extension) and typechecks only as the built
   `dist/tui.tsx` — run `tsc` against the build output (temp tsconfig with
   `jsx: "preserve"`, `jsxImportSource: "@opentui/solid"`, `moduleResolution: "bundler"`).
k. **Disabling built-in TUI plugins**: built-ins are real plugins with ids
   (`opencode.sidebar.context` = the built-in sidebar Context section; also
   `.sidebar.footer/.limit/.mcp/.todo`, `opencode.notifications`, …). Permanent disable is a
   cli.json `plugins` **directive with a `-` prefix**, e.g.
   `"plugins": ["-opencode.sidebar.context", "/app/plugins/context-progress"]`
   (docs: opencode.ai/v2/docs/cli/plugins — wildcards like `-team.*` also work; `!` prefix is
   NOT a thing and gets npm-install-attempted). The plugins-dialog toggle (ctrl+p → Plugins →
   ctrl+a "show internal" → select → enter) works immediately but is intentionally NOT
   persisted in V2 ("toggles from the plugins dialog are no longer saved"). Verified live:
   with the `-` entry, only our widget renders (builtin `tokens` section gone), on every boot.

## Live verification results (2026-11-07, OpenCode v2.2.6 in this container)

Method: isolated `HOME=/tmp/opencode/home` (user's live config untouched), scratch project,
`cli.json` → `"plugins": ["/app/plugins/context-progress"]`, real TUI driven over a Python
PTY (`pty.fork` + `TIOCSWINSZ` 50x170; `script(1)` does NOT work — with a piped stdin it runs
`<not executed on terminal>` and keystrokes never reach OpenTUI). Real prompt against local
model `isoruokki2/ling-3.0-tiny`.

1. PASS — `npm install` / `npm run build` / `npm run pack:dry` clean; `npm ls` exit 0.
2. PASS — plugin loads from local path (`plugin reconciliation completed`, widget renders).
3. PASS — widget renders `Context` / 24-char bar / `6%` / `5,544 / 98,304 / $0.00`,
   cross-validated against the host's own native indicators (`6% used`, `5.5K (6%)`).
   Note: the V2 host sidebar has its own built-in "Context" usage section — don't confuse
   it with this widget when grepping captures; identify ours by the `tokens / window / $cost`
   detail line.
4. PASS — reactivity without manual invalidate: widget went `0%` → `6%` with real token/cost
   numbers within ~5s of the assistant reply completing, no restart.
5. PASS — fresh session route shows `0 / -- / $0.00` at 0% (full `░` bar), no errors.
   "New session" (palette) navigates to the home route where no sidebar exists — the widget
   correctly unmounts; a session route only exists after the first prompt.
6. NOT EXERCISED — 70%/90% color thresholds (would need a ≥70% session); code path uses the
   verified tokens and V1-identical thresholds.
7. PARTIAL — unmount-on-navigation clean; in-TUI disable/reload (plugins dialog) not scripted.
8. PASS — packed tarball (`npm pack`, unpacked to a path OUTSIDE the workspace, no
   `node_modules` of its own) loaded via `cli.json` path entry; bare `@opencode/plugin/tui`,
   `@opentui/*`, `solid-js` imports resolved from the host at runtime — confirming the
   peer-dependency model.

## Risks and open questions

- **Unverified type-level names** (theme token paths, message field locations, model
  context-limit field, `cost()` return shape, slot-props type). Mitigation: mandatory step 2
  type inventory before coding; the V1 code is already defensive, keep fallbacks so a wrong
  guess degrades to zeros instead of a crash.
- **Cache reactivity semantics**: RESOLVED — the solid data store is event-driven and
  self-refreshes; no `listen`+`invalidate` wiring needed (see Live verification item 4).
- **Slot ordering**: V1's `order: 100` has no V2 equivalent shown in the docs; with the other
  three plugins later appended to `sidebar.content` too, stacking order will follow
  registration/placement rules ("several claims at one anchor coexist in plugin enable order"
  per `SlotClaim` docs). Revisit when porting plugin #2 if ordering matters.
- **README install command**: RESOLVED — V2 has `opencode plugin add <package>` ("install a
  plugin and add it to the global configuration"); READMEs use it.
- **`@opencode/plugin` npm availability/version pinning**: RESOLVED — latest is `2.2.6`;
  `package.json` pins `^2.2.6`.
- **Publishing is out of scope**: no `npm publish`, no git tags — repo-owner decision later.
  The old `1.x` line implicitly remains the V1 artifact.
