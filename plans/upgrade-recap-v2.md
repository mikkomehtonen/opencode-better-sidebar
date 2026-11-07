# Upgrade `recap` plugin from OpenCode V1 to V2 (port #3)

## Objective and requirements

Third plugin of the V2 migration (pilots: `context-progress`, `open-in` — facts a–n in
`plans/upgrade-context-progress-v2.md` + `plans/upgrade-open-in-v2.md` are reused). Same rules:
V2-only, keep name/`./tui`/`cp` build, behavior parity, don't touch `session-tokens`, no
publish/tag/push.

V1 behavior (286 lines): sidebar "Recap" button; click → build transcript of last 10 messages
(text parts), create throwaway session, prompt a summarization instruction (model = configured
options or last assistant model), wait for `session.idle` (30s timeout), fetch reply, delete
throwaway session; render result as markdown in the sidebar; auto-clear after 3 busy status
events (prompts) since last recap; errors shown inline as italic markdown.

## V2 mapping (verified against shipped .d.ts + host binary, 2026-11-07)

New facts for this port (o–u):

- o. **`client.session.generate({ sessionID, prompt }): Promise<{ text: string }>`** — one-shot
  completion on a session, awaits completion. Replaces V1's create→prompt→idle-wait→re-fetch→
  echo-filter dance (keep create + remove around it for the throwaway session).
- p. **Client return shapes**: promise client returns unwrapped data
  (`session.create({}) → SessionInfo` directly, NOT V1's `{ data }`). Delete is
  **`session.remove({ sessionID })`**. Message fetch: `session.context({ sessionID }) →
  SessionMessageInfo[]` (or the reactive `data.session.message.list`).
- q. **V2 message content**: `SessionMessageUser` has `text: string` directly;
  `SessionMessageAssistant` has `content: Array<{type:"text"|"reasoning"|"tool", …}>` and
  `model: ModelRef { id, providerID }` — no `info`/`parts` wrappers, no `.role` (discriminator
  is `type`, cf. fact d).
- r. **Session-create model**: `SessionCreateInput.model: { id, providerID, variant? }` — model
  goes on the throwaway session itself (V1 passed it on `session.prompt`).
- s. **Events**: payload lives under **`.data`** (V1: `.properties`), but the V1 event names
  **`session.status` and `session.idle` are dead in V2** — present in the
  `EventSubscribeOutput` type union, never emitted by the 2.2.6 server (verified live with an
  event tap: zero deliveries across multiple prompts, while `data.listen`/`data.on` receive
  everything else). Actual per-prompt sequence: `session.inbox.enqueued` →
  **`session.execution.started`** (once per prompt) → step/reasoning/text events →
  `session.usage.updated` → `session.execution.succeeded`. The staleness counter uses
  `session.execution.started`. Listener arg shape: `{ name, details }`, session id at
  `details.data.sessionID`. Typed helper: `context.data.on(type, handler)` returns unsubscribe.
- t. **SyntaxStyle is native-owned in OpenTUI ≥0.6**:
  `SyntaxStyle.fromStyles(styles, owner: NativeResourceOwner)` requires an owner exposing
  `.resourceContext`; `context.renderer.nativeScene: NativeScene` is one (host itself does
  `fromTheme(theme, renderer.nativeScene)`). Style names unchanged: the 9 syntax scopes
  `comment keyword function variable string number type operator punctuation`; theme tokens
  now nested: `context.theme.syntax.<token>` (V1 flat `syntaxComment`). `@opencode/theme/tui`
  exposes `generateSyntax(theme, owner)` BUT `@opencode/theme` is NOT in the host's plugin
  runtime module map (verified from the exe: map has `@opencode/plugin*`, `@opentui/*`,
  `solid-js`, node builtins — not `@opencode/theme`) → keep the manual map via
  `@opentui/core` (runtime-proven import).
- u. **`<markdown>` JSX survives 0.8.3**: props `content`, `syntaxStyle` (still REQUIRED),
  `fg` unchanged.

Also: plugin options arrive via `context.options` (V1: `main(api, options)` second arg);
cli.json config is `{ "package": "…", "options": {…} }` entries.

## Implementation

1. Rewrite `plugins/recap/index.ts`:
   - Keep: prompts/thresholds, module-level recap/loading signals, prompt counters,
     `readConfiguredModel`, busy-event staleness, inline error display, View JSX.
   - `buildSyntaxStyle(context)` → `SyntaxStyle.fromStyles({...from context.theme.syntax},
     context.renderer.nativeScene)`; memoize per component (native handle — do NOT rebuild on
     every render; createMemo mirrors host behavior).
   - Transcript from reactive `data.session.message` (sync on mount, list in handler):
     user → `user: ${text}`; assistant → join `content` text items.
   - `generateRecap`: `create({ title?, model? })` → `generate({ sessionID, prompt })` →
     `.text`; 30s timeout race kept; `finally { remove(id) }`.
   - Slot/usePlugin/define/theme-token/toast patterns identical to pilots.
2. `package.json`: 2.0.0, `@opencode/plugin ^2.2.6`, peers, engines — template shape.
3. Build + strict tsc (harness; note: `@opencode/theme` needed locally only for tsc of
   context.d.ts — installed `--no-save`), pack:dry.
4. README: V2 install; options config moves from `tui.json` `plugin` array to
   `cli.json` `{ package, options }`; drop V1 troubleshooting that no longer applies.
5. Live verification (isolated HOME + PTY harness):
   a. real click on "Recap" → "Generating..." → markdown recap renders (local model
      isoruokki2/ling-3.0-tiny); transcript picks up prior session content;
   b. throwaway session cleaned: `session_v2` row count unchanged after recap;
   c. staleness: recap survives 1 new prompt, clears at 3 (verifies `session.status` `.data`
      shape live);
   d. options error path: cli.json entry `{"package": path, "options": {"providerID": "x"}}` →
      click → inline `*Error: Invalid recap plugin config…*` (verifies `context.options`);
   e. packed tarball loads (peer resolution).

## Results (filled during implementation)

All verified 2026-11-07, isolated `HOME=/tmp/opencode/home`, TUI over the Python PTY harness,
model `isoruokki2/ling-3.0-tiny`:

1. PASS — `npm install` / build / strict `tsc` (with `@opencode/theme` restored via
   `npm install --no-save` so `ResolvedTheme` types resolve for real — plain `npm install`
   prunes it again; it is not in any package.json by design, fact h) / `npm ls` clean /
   `pack:dry` ships `dist/tui.tsx` + README + recap.png.
2. PASS — success path: click on "Recap" → "Generating..." → recap markdown rendered in the
   sidebar ("Working on: … / Done: … / Next: …" from the local model) — proves transcript
   build (reactive `data.session.message`), `session.create({ model })` +
   `session.generate` + `session.remove`, and the owner-tied `SyntaxStyle.fromStyles(…,
   renderer.nativeScene)` (no native owner-mismatch crash, markdown scopes fall back to `fg`
   cleanly).
3. PASS — cleanup: `session_v2` row count unchanged after the run (throwaway session gone).
4. **FINDING** — V1 staleness wiring (`session.status` busy) silently no-ops in V2: an event
   tap (`data.listen` logging every event) showed `session.status`/`session.idle` are NEVER
   emitted by 2.2.6 (dead type-union names; fact s). Prompt activity surfaces as
   `session.inbox.enqueued` + `session.execution.started` (exactly one each per prompt).
   Fixed: staleness counter now on `data.on("session.execution.started", e => e.data.
   sessionID)`.
5. PASS — staleness after the fix (instrumented copy of the exact shipped logic): recap
   survives prompt 1 and 2, clears on prompt 3 (log: 3× exec-started `hadRecap=true`, then
   `CLEARED`).
6. PASS — options path: cli.json `{"package": …, "options": {"providerID": "x"}}` → click →
   inline "*Error: Invalid recap plugin config…*" — `context.options` + `{ package, options }`
   entries work live.
7. PASS — fresh smoke test of the shipped `plugins/recap` code end-to-end.

Facts for the last port: (o) `client.session.generate`, (p) unwrapped promise-client returns +
`session.remove`, (q) message `text`/`content` shapes, (r) model on session-create, (s) event
names/payload paths, (t) native-`SyntaxStyle` + `renderer.nativeScene` owner +
`theme.syntax.<token>`, (u) `<markdown>` props unchanged.
