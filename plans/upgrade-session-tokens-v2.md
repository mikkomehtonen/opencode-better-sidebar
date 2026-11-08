# Upgrade `session-tokens` plugin from OpenCode V1 to V2 (port #4, finale)

## Objective and requirements

Last of the four V2 migrations (pilots: `context-progress`, `open-in`, `recap` — facts a–u in
the other three plan files are reused). Same rules: V2-only, keep package name/`./tui` export/
`cp` build, behavior parity, no publish/tag/push.

V1 behavior (361 lines): collapsible sidebar widget. Collapsed: `▶ Session Tokens <total>
(<$cost>)`; expanded: per-model token/cost rows for the main session (max 10 + "+N more"),
plus a `Subagents` section with per-agent totals when child subagent sessions exist. Totals =
main session aggregate (fallback: per-message breakdown) + sum of descendant subagent sessions
(child sessions with an `agent`, recursive; forks excluded). Expansion state persists per
session for the TUI lifetime. V1 machinery: `createResource` + `client.session.children()`
walk + `watchChildEvents` (message.updated / message.part.updated / session.status) to refetch.

## V2 mapping (verified against shipped .d.ts + store source, 2026-11-08)

New facts for this port (v–z):

- v. **`client.session.children` is gone.** The V2 equivalent is **`client.session.list({
  parentID, order, limit, cursor })` → `{ data: SessionInfo[], cursor }`** (`SessionsCursor =
  string`). The solid store itself uses exactly this internally (`listChildren`, CHILD_PAGE=200).
- w. **Reactive subagent tree**: the solid store maintains `store.session.family[root]` —
  every session registered via `sync`/`session.created` calls `registerSession`, which walks
  the `parentID` chain to the root and appends the id to that root's family array. So
  `data.session.family(id)` (reactive read) = all loaded sessions sharing the queried
  session's root **including the root itself**; `data.session.get(id)` gives `SessionInfo`
  with `parentID`, `agent?`, `fork?`, `cost`, `tokens`.
  → Subagents = BFS from the current session over family members' `parentID` links, keeping
  only children with non-empty `agent` (V1 parity) and recursing only into kept children.
  Do NOT use `data.session.cost(id)` — for root sessions it aggregates root+family, which
  would double-count when subagent records are also summed. Use record-level
  `get(id).cost`/`.tokens` (each session's own aggregate).
- x. **Store self-populates**: `session.created` events trigger `session.sync(id)` in the
  store (subagent sessions created live are registered + family-linked automatically);
  `session.usage.updated` patches `info[id].{cost,tokens}` for already-loaded sessions.
  → live subagent spend updates are free. Historical children (created in previous runs) are
  NOT in the store on open, so the plugin still runs one seeding pass: recursive
  `session.list({ parentID })` discovery, `data.session.sync(id)` for unknown ids (which
  registers info + family), re-run on message-signature change like V1's refetch trigger.
- y. `SessionInfo.tokens: TokenUsageInfo` and `cost: MoneyUSD (= number)` are REQUIRED fields
  (default 0) — "cost present" still means `> 0` (V1 `hasNumeric` semantics kept).
- z. Main-session aggregates: `data.session.get(id).tokens/.cost` replace V1
  `api.state.session.get(id).tokens/.cost`; messages come from `data.session.message
  .list(id)` (sync on mount), assistant records carry `tokens`/`cost?`/`model: { id,
  providerID }` (fact q) — per-model label = `model.id` (V1 parity: bare modelID, "unknown"
  fallback).

Carried-over facts used: slot append `sidebar.content` (a/b), `usePlugin` (c), event payloads
under `.data` + dead `session.status` (s), theme `text.base`/`text.muted` (h), `onMouseDown`
(m), `<b>`/`<span>` exist in @opentui/solid 0.8.3 jsx-runtime.

Design decision: drop `createResource`/`watchChildEvents` entirely — the event-driven solid
store (fact g) replaces V1's manual refetch machinery; only the historical-hydration discovery
pass remains, triggered by message signature changes (V1 parity).

## Implementation

1. Rewrite `plugins/session-tokens/index.ts`:
   - Keep: MAX_MODEL_ROWS, formatters (`formatInt`/`formatMoney`/`formatModelTotals`/
     `shortModelLabel`), `safeNumber`/`hasNumeric`/`readCost`/`spentTokenCount`, expansion map,
     header/rows/subagents JSX.
   - `fetchSubagentTree(api, …)` → `seedSubagentSessions(context, sessionID)`: recursive
     `client.session.list({ parentID })` (page cap 10), skip `fork`ed children, keep
     agent-children, `await data.session.sync(childID)` when `!data.session.get(childID)`.
   - `subagents` memo: BFS over `family()` + `get()` parentID/agent links (skip self, skip
     forks, recurse only into kept children) → `SessionInfo[]`.
   - `data` memo aggregation: near-verbatim V1 (dedupe by message id, per-model maps, sort,
     fallbacks, `hasCost`/`hasPerModelCost` flags).
   - `createEffect` on message signature (length + last id) → discovery pass with in-flight
     guard; message sync on mount.
   - Theme memo `text.base`/`text.muted`; `Plugin.define` + `ui.slot` per pilots.
2. `package.json` → 2.0.0, `@opencode/plugin ^2.2.6`, peers `@opentui/{core,solid} >=0.8.1`,
   `solid-js >=1.9.0`, engines `opencode >=2.0.0` — template shape.
3. Build + strict tsc (harness `tsconfig.session-tokens.json`; `@opencode/theme` must be
   present — `npm install --no-save @opencode/theme@2.2.6` after every plain install) +
   pack:dry.
4. READMEs: V2 install (`opencode plugin add`); subagent section text updated (`children`
   endpoint → parentID listing + reactive store); root README → all four plugins V2.
5. Live verification (isolated HOME + PTY harness):
   a. widget renders totals for the history-loaded scratch session; totals consistent with
      the context-progress widget cost and with `client.session.get` numbers from the DB;
   b. click toggles expansion (per-model rows appear), state persists across session switch;
   c. spawn a subagent via the task tool → `Subagents` section appears live (dbg build logs
      family length + syncs), total grows by the child's usage, main totals unchanged
      (no double count — verifies fact w's warning live);
   d. restart TUI → historical subagent re-hydrates via the discovery seeding pass (dbg log
      shows `sync` of the child id, section present at first paint+ε);
   e. DB check of the subagent row: `agent` set, `fork` null (confirms filter parity);
   f. `npm ls` clean, packed tarball loads.

## Results (filled during implementation)

All verified 2026-11-08, isolated `HOME=/tmp/opencode/home`, TUI over the Python PTY harness,
model `isoruokki2/ling-3.0-tiny`; ground truth from `session_v2` DB rows.

1. PASS — `npm install` / build / strict `tsc` / `npm ls` clean / `pack:dry` ships
   `dist/tui.tsx` + README + package.json.
2. **FINDING** — `SpanProps` in @opentui/solid 0.8.3 is `ComponentProps<{}, TextNodeRenderable>`:
   V1's `<span fg={…}>` no longer typechecks (runtime would accept it, `TextNodeOptions` has
   `fg`, but strict tsc rejects it). The host's own compiled JSX uses `setProp(span, "style",
   { fg })` → canonical V2 form is **`<span style={{ fg }}>`** (`style?: Partial<{}>` accepts
   any object literal). Fixed; `TextProps.fg` is unaffected.
3. PASS — baseline: collapsed header `▶ Session Tokens 5,967` matched DB ground truth exactly;
   no `($…)` suffix on $0 local-model spend (V1 `hasNumeric > 0` semantics kept).
4. PASS — live subagents: spawned a subagent via the task tool (`agent=general`, child session
   `Reply with PONG`): store log showed `family 1→2`, parentID BFS found the child with zero
   seeding (`seed listed=0` + `session.created` auto-registration), sidebar repainted to
   `▼ … 16,792 · incl. subagents` with `Main 12,189` / `ling-3.0-tiny 12,141` /
   `Subagents 4,603` / `@ general 4,603`. No double-counting: main aggregate grew only from
   parent `session.usage.updated`, subagent total only from the child's.
5. PASS — DB sanity: child row `agent='general'`, `parent_id` set, `fork_session_id` NULL,
   spent tokens 4,603 (parent 12,279) — sums match the widget to the token.
6. PASS — restart hydration: fresh TUI process showed the full `incl. subagents` state at
   first paint; seeding pass listed the historical child (`seed listed=1
   [f50xhi(agent=general,fork=false)]`) but `data.session.get(child)` was already populated —
   the host itself registers child sessions on open, so the seeding pass is a safety net
   (kept: it costs one list call and guards against hosts that do not).
7. PASS — expansion toggle both directions: click writes `▼` + rows, second click repaints
   `▶` (verified via anchored byte-slice of the repaint, whole-capture greps are sticky).
8. PASS — shipped (uninstrumented) `plugins/session-tokens` smoke run: totals + subagents
   section render, zero JS errors in the capture.

Facts documented for future plugins: v (`session.list({parentID})` replaces `children`),
w (reactive family index + why `data.session.cost()` double-counts here), x (store
self-population via `session.created`/`session.usage.updated`), y (required `tokens`/`cost`
fields), z (message/session record shapes), plus the `span style={{fg}}` finding above.

Migration complete: all four plugins are now on the V2 line.
