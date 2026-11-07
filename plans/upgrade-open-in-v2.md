# Upgrade `open-in` plugin from OpenCode V1 to V2 (port #2)

## Objective and requirements

Second plugin of the 4-plugin V2 migration (pilot: `plugins/context-progress`, already ported —
see `plans/upgrade-context-progress-v2.md` for the authoritative V2 API inventory, facts a–k,
reused here). Requirements mirror the pilot:

1. **V2-only**: no hybrid V1/V2 export; V1 users keep the published 1.0.0.
2. Keep monorepo layout, package name `@streetturtle/opencode-open-in`, `./tui` export,
   `cp index.ts dist/tui.tsx` build.
3. Behavior parity: sidebar "Open In" section listing installed IDEs (Zed, VS Code, Cursor)
   as clickable `[Label]` buttons that open the session directory via macOS `open -a` / `zed`.
4. Do NOT touch `recap` / `session-tokens`.
5. No `npm publish`, no tags, no push.

## V1 usage in `plugins/open-in/index.ts` (198 lines)

- `TuiPlugin`/`TuiPluginApi` from `@opencode-ai/plugin/tui`; slot
  `slots.register({ order: 290, slots: { sidebar_content(_ctx, props) } })`;
  `export default { id: "streetturtle.open-in", tui: main }`.
- `api.state.path.directory` — V1 `TuiState.path` = `{ state, config, worktree, directory }`
  (the TUI process paths); used as first-choice target directory.
- `await api.client.session.get({ sessionID })` → `data.path` (may be relative),
  `data.directory` — fallback target resolution.
- `api.ui.toast({ variant: "error", message })` on failure.
- `api.theme.current.text` / `.textMuted`.
- `<text onMouseDown={...}>` buttons (custom clickable text, no built-in button widget).
- Module-level signal maps (`busyBySession`, `availabilityByIDE`) + `refreshIDEAvailability()`
  called synchronously in plugin setup (spawns `which zed` / `open -Ra` on darwin; marks all
  IDEs "missing" on other platforms).

## V2 mapping (verified against shipped .d.ts, 2026-11-07)

| V1 | V2 |
|---|---|
| `TuiPlugin` + `{ id, tui }` export | `Plugin.define({ id: "streetturtle.open-in", setup(context) })` (fact a) |
| `slots.register({ order, sidebar_content })` | `context.ui.slot({ append: "sidebar.content", render: ({ sessionID }) => … })` — no `order` (fact b) |
| `api.theme.current.text/.textMuted` | `context.theme.text.base` / `context.theme.text.muted` (fact f) |
| `api.state.path.directory` + `api.client.session.get` chain | session dir: `data.session.get(sessionID)?.location.directory` (+ `?.subpath` via `resolve()`), then `context.location?.directory`, then `data.location.default()?.directory` |
| `api.ui.toast({ variant, message })` | `context.ui.toast.show({ variant, message })` (fact l below) |
| `<text onMouseDown>` | unchanged — still supported in OpenTUI 0.8.3 (fact m below) |

New facts verified for this port:

- l. **Toast**: `context.ui.toast: Toast` with `show(options: ToastOptions): void`;
  `ToastOptions = { title?, message, variant?: "info"|"success"|"warning"|"error", duration?,
  sessionID? }` (`@opencode/plugin/dist/tui/context.d.ts:236–247`). V1's flat
  `api.ui.toast({...})` becomes `context.ui.toast.show({...})`.
- m. **Mouse events**: `onMouseDown` remains a Renderable prop in `@opentui/core@0.8.3`
  (`Renderable.d.ts:80`, applied via `applyEventOptions` in the bundled solid renderer; the
  host binary itself uses `onMouseDown` 17×). JSX `<text onMouseDown={fn}>` keeps working.
- n. **Paths**: `LocationRef = { directory: AbsolutePath, workspaceID? }`;
  `SessionInfo.location: LocationPublicRef { directory }`, `SessionInfo.subpath?:
  RelativePath` (`@opencode/client` `promise/generated/types.d.ts:3169–3196, 569, 959`).
  `context.location: LocationRef | undefined`; `data.location.default(): LocationRef`.

**Intentional deviation from V1 ordering**: V1 preferred the TUI process directory
(`state.path.directory`) over the session's own directory — wrong for sessions located
elsewhere (possible with V2 tabs). The port prefers the session's `location.directory`
(+`subpath`), falling back to `context.location` then `data.location.default()`. Matches the
README promise ("Opens the active session directory") in all cases.

Also: the click handler no longer awaits `client.session.get` — the reactive cache
(`data.session.get`) is already populated for any session whose sidebar is rendering.

## Implementation

1. Rewrite `plugins/open-in/index.ts`: helpers (`IDEs`, signal maps, `resolveZedCLIPath`,
   `checkIDEInstalled`, `refreshIDEAvailability`, busy/availability logic, JSX) kept;
   rewire `api.*` per mapping; `Context` type imported from `@opencode/plugin/tui/context`.
2. `package.json`: 2.0.0, `@opencode/plugin ^2.2.6` dep, peers `@opentui/core >=0.8.1`,
   `@opentui/solid >=0.8.1`, `solid-js >=1.9.0` (fact h), `engines.opencode >=2.0.0`.
3. `npm install` (regenerates lock), `npm run build`, strict `tsc` on built `dist/tui.tsx`
   (fact j), `npm run pack:dry`.
4. README (plugin + root): `opencode plugin add` install, OpenCode-2 note. No built-in
   replacement section needed (no built-in counterpart).
5. Live verification, isolated `HOME=/tmp/opencode/home` like the pilot.

## Tests and verification

1. `npm install` / `npm run build` / `tsc` / `pack:dry` clean.
2. Plugin loads in the V2 TUI (isolated HOME, `cli.json` path entry); sidebar shows the
   "Open In" header (on Linux all IDEs are "missing" → no buttons, header only — parity with
   V1 behavior off-macOS).
3. **Linux-simulated macOS**: scratch copy of the built widget in `/tmp/opencode` (outside the
   repo) with the `darwin` guard relaxed and launch/check commands swapped to Linux binaries,
   driven over the PTY harness to verify: buttons render for "available" IDEs, an SGR mouse
   click (`ESC [ <0;col;rowM` + `m`) fires `onMouseDown` → launch path, success = no toast,
   failing launcher = error toast via `ui.toast.show` (verifies the toast API live).
4. Empty/edge state: no buttons → just the header, no crash.
5. Packed tarball loads by path (peer-resolution) — same as pilot, covered by the tarball
   `npm pack` + `cli.json` path entry.

## Results (filled during implementation)

All verified 2026-11-07, isolated `HOME=/tmp/opencode/home`, TUI over the Python PTY harness:

1. PASS — `npm install` / `npm run build` clean; strict `tsc` (harness
   `/tmp/opencode/typecheck/tsconfig.open-in.json`, `types: ["node"]` + root `typeRoots` for
   the `node:*` imports) passes on built `dist/tui.tsx` — including `onMouseDown` on `<text>`,
   `ui.toast.show`, `data.session.get(...).location.directory`. `ReturnType<typeof usePlugin>`
   used for the context parameter type (avoids depending on the `./tui/context` subpath export).
2. PASS — real port loads from the workspace path: sidebar renders the "Open In" header, no
   buttons on Linux (all IDEs "missing" — parity with V1 off-macOS), no errors.
3. PASS — macOS simulation (`/tmp/opencode/open-in-mac`: darwin guards disabled,
   `checkIDEInstalled → true`, fake `zed` on PATH logging its args):
   - all three `[Zed] [VS Code] [Cursor]` buttons render;
   - SGR mouse click (`ESC [ <0;col;rowM` + `m`, coords parsed from the last frame) fires
     `onMouseDown`;
   - success path: fake zed received `zed-open: /tmp/opencode/scratch` — V2 session directory
     resolution (`data.session.get(id).location.directory`) correct — and no toast;
   - failure path: clicking `[VS Code]` (no `open` binary) shows the error toast
     `Open In: Executable not found in $PATH: "open"` — `context.ui.toast.show` works live.
4. PASS — header-only state on Linux: no crash.
5. PASS — packed tarball (`npm pack`, unpacked outside the workspace, no own `node_modules`)
   loads by path entry; `@opencode/plugin/tui`, `@opentui/*`, `solid-js` resolve from the host.

Facts for the remaining ports: (l) toast is `ui.toast.show(ToastOptions)`, (m) `onMouseDown`
survived into OpenTUI 0.8.3 and solid-JSX passes it through, (n) `SessionInfo.location.directory`
+ `subpath` replace V1 `directory`/`path`; PTY mouse clicks can be scripted with SGR sequences
(the host enables mode 1006).
