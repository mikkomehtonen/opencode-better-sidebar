# Session Tokens: add an "(other)" reconciliation row so visible rows sum to Main

## Objective and requirements

The sidebar plugin `@streetturtle/opencode-session-tokens` renders a "Session Tokens"
breakdown. The `Main` row and the nested per-model rows are computed from two different
data sources, which makes the widget look arithmetically wrong (e.g. Main = 8,236 while
its only model row `qwen3.8-flash-next-iq3s` shows 8,191):

- **Main** reads the server-side session aggregate `SessionInfo.tokens`, which includes
  usage from LLM calls that never appear as transcript assistant messages — most notably
  **title generation**, which runs once right after the first prompt (observed as a ~45
  token delta present from the very beginning of a session).
- **Per-model rows** sum `message.tokens` over assistant messages only. Messages without
  role `assistant` (hidden/system/synthetic) are skipped, so title-generation usage is
  invisible in the breakdown.

Both sides use the same per-token formula, so the numbers are individually correct — but
a user sees `8,236` above `8,191` and reads it as a bug.

**Requirement:** the per-model rows displayed under `Main` must always sum exactly to
`Main`. When the session aggregate exceeds the per-message breakdown sum, append a
synthetic `(other)` row carrying the difference (tokens and cost). No server/core changes
are possible or needed — this is a display-layer reconciliation inside the plugin.

Non-goals:

- Do not attempt to attribute the delta to the title model's real model ID (the usage
  event carries no transcript message, so the ID is not retrievable client-side).
- Do not change the `Subagents` section (it already reconciles: its total and its
  per-agent rows sum the same child-session values twice).
- No test infrastructure exists in this repo; do not introduce a test framework.

## Relevant existing architecture

Repo: `/app` — npm workspaces monorepo `opencode-better-sidebar` (private,
`workspaces: ["plugins/*"]`). Plugins are single-file TUI plugins:
`plugins/session-tokens/index.ts` is copied verbatim to `dist/tui.tsx` by the
workspace `build` script (`rm -rf dist && mkdir -p dist && cp index.ts dist/tui.tsx`).
There are no tests, no tsconfig, no lint config. UI is Solid-TSX via `@opentui/solid`.

File `plugins/session-tokens/index.ts` (the only code file):

- Line 24: `const MAX_MODEL_ROWS = 10` — truncation cap for model rows; rows beyond it
  render as `+N more` (lines 363–365), so truncation is already user-visible.
- Lines 49–70: `readCost(source)` → `{ present, value }`, reads `cost`/`info.cost`/
  `usage.cost`/`metrics.cost`; "present" means `> 0`.
- Lines 72–78: `spentTokenCount(tokens)` → `input + output + reasoning + cache.write`
  (cache.read intentionally excluded — it is context, not spend).
- Lines 157–390: `View` component. `data()` memo (lines 224–323) computes everything:
  - Lines 233–257: loop over `context.data.session.message.list(sessionID)`; skips
    non-assistant roles (line 235), dedupes by message ID (237–239), accumulates
    `breakdownTokenTotal` and per-model `tokenTotals` / `costTotals` maps (241–256).
  - Lines 259–265: builds `perModel` array from the two maps, sorted tokens desc.
  - Lines 267–273: reads the session record and derives Main:

    ```ts
    // Record-level (own) aggregates — data.session.cost() would fold the family in and
    // double-count the subagent rows summed below.
    const session = context.data.session.get(props.sessionID)
    const sessionTokenTotal = spentTokenCount(session?.tokens)
    const sessionCost = readCost(session)
    const mainTokens = sessionTokenTotal > 0 ? sessionTokenTotal : breakdownTokenTotal
    const mainCost = sessionCost.present ? sessionCost.value : breakdownCostTotal
    ```

  - Lines 275–305: subagent totals (untouched by this change).
  - Line 306: `hasCost = sessionCost.present || hasBreakdownCost || hasSubagentCost`.
  - Line 307: `hasPerModelCost = costTotals.size > 0`.
  - Line 310: `totalTokens: mainTokens + subagentTokens`.
- Rendering (lines 348–386): `Main` row (349–355, shown only when subagents exist),
  per-model rows via `<For each={data().perModel.slice(0, MAX_MODEL_ROWS)}>` (356–362),
  `+N more` (363–365), Subagents section (367–385).

The session aggregate `SessionInfo.tokens` is patched live by the TUI store from
`session.usage.updated` events (see header comments at lines 15, 185–187 and
`plans/upgrade-session-tokens-v2.md` lines 37, 42). The aggregate therefore contains
title-generation usage immediately, while it never reaches the message list.

## Proposed implementation

Anchor `Main` on `max(sessionAggregate, breakdownSum)` (the aggregate can also *lag*
the breakdown transiently mid-turn; today that would make rows sum to MORE than Main)
and expose any positive difference as a synthetic `(other)` row pushed into `perModel`
before sorting. Because both the data memo and the row rendering flow through
`perModel`, **no JSX changes are required**.

Reconciliation invariants after the change:

- `sum(perModel[i].tokens for visible+truncated rows) === mainTokens`
- `sum(perModel[i].cost) === mainCost`
- `hasPerModelCost` is true whenever any per-model row (including `(other)`) has cost > 0.

### New computation (replaces current lines 259–273, order flips: session totals first)

```ts
    const session = context.data.session.get(props.sessionID)
    const sessionTokenTotal = spentTokenCount(session?.tokens)
    const sessionCost = readCost(session)
    // The server-side session aggregate includes usage that never lands on a transcript
    // assistant message (e.g. title generation right after the first prompt), so it can
    // exceed the per-message breakdown. Anchor Main on the larger of the two and expose
    // the difference as an "(other)" row so the visible rows always sum to Main.
    const mainTokens = Math.max(sessionTokenTotal, breakdownTokenTotal)
    const mainCost = sessionCost.present
      ? Math.max(sessionCost.value, breakdownCostTotal)
      : breakdownCostTotal

    const perModel = [...new Set([...tokenTotals.keys(), ...costTotals.keys()])]
      .map((model) => ({
        model,
        tokens: tokenTotals.get(model) ?? 0,
        cost: costTotals.get(model) ?? 0,
      }))

    const otherTokens = mainTokens - breakdownTokenTotal
    const otherCost = mainCost - breakdownCostTotal
    if (otherTokens > 0 || otherCost > 0) {
      perModel.push({ model: "(other)", tokens: otherTokens, cost: otherCost })
    }
    perModel.sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)
```

And line 307 becomes:

```ts
    const hasPerModelCost = costTotals.size > 0 || otherCost > 0
```

Notes on the design:

- `(other)` sorts naturally by size like any model row; since it is small (tens of
  tokens) it lands at the bottom, but if it ever dominated it would sort up — that is
  honest reporting, not a problem.
- `shortModelLabel("(other)")` (lines 97–104) returns it unchanged (≤ 28 chars).
- Main anchor change: previously `sessionTokenTotal > 0 ? sessionTokenTotal :
  breakdownTokenTotal`. `Math.max` preserves that behavior whenever the aggregate ≥
  breakdown (including aggregate = 0 → fallback to breakdown) and additionally fixes the
  stale-aggregate direction (aggregate < breakdown now shows the breakdown instead of
  under-reporting Main).
- Cost mirrors tokens exactly; `(other)` cost appears only if the aggregate cost exceeds
  the per-message cost sum (title generation also incurs cost).
- If a session's ONLY usage is title generation (pathological), `perModel` = [`(other)`],
  `canExpand()` (line 326) stays true, and the widget remains coherent.

## Files that need modification

| File | Change |
|---|---|
| `plugins/session-tokens/index.ts` | Replace the block at lines 259–273 (perModel build + Main derivation) with the snippet above; update `hasPerModelCost` (line 307). No other lines change. |
| `plugins/session-tokens/README.md` | Update "What it shows" and "Counting logic" sections (see below). |
| `plugins/session-tokens/package.json` | Version bump `2.0.0` → `2.1.0` (minor feature; published package). |

Do not touch: `plugins/session-tokens/dist/` (generated by `npm run build`), the
Subagents section, `plans/upgrade-session-tokens-v2.md` (historical record), root
`README.md` (only links the plugin).

## Step-by-step implementation instructions

1. Open `plugins/session-tokens/index.ts`. Locate the block starting at the line
   `const perModel = [...new Set([...tokenTotals.keys(), ...costTotals.keys()])]`
   (line 259) and ending with
   `const mainCost = sessionCost.present ? sessionCost.value : breakdownCostTotal`
   (line 273), including the two-line comment
   `// Record-level (own) aggregates — data.session.cost() would fold the family in and`
   `// double-count the subagent rows summed below.`
2. Replace that entire block with the "New computation" snippet above (session totals
   first, then `perModel` build, then conditional `(other)` push, then sort). Keep the
   existing `const hasSubagents = ...` (line 305) and `const hasCost = ...` (line 306)
   lines unchanged.
3. Update line 307 from `costTotals.size > 0` to `costTotals.size > 0 || otherCost > 0`.
4. Sanity-check by search: after the edit, `breakdownTokenTotal` must still be produced
   by the message loop and `mainTokens`/`otherTokens` used exactly where the snippet
   says; `perModel` must be built exactly once; there must be exactly one `.sort(` for
   perModel (the current sort at line 265 moves into the new block — do not leave a
   second sort).
5. README (`plugins/session-tokens/README.md`):
   - In "What it shows" (after the bullet on line 13), replace the line-13 bullet and
     add bullets so the section conveys:
     - `Main` uses the session-level token/cost aggregate reported by OpenCode.
     - An `(other)` row appears when the session aggregate exceeds the sum of per-model
       rows; it reconciles session-level usage that has no transcript message (e.g.
       automatic title generation after the first prompt). Visible rows always sum to
       `Main`.
   - In "Counting logic", append:
     - `(other)` = session aggregate − per-message breakdown (tokens and cost); it never
       shows zero and disappears when there is no difference
   - Keep the existing line-13 fallback behavior documented: Main is
     `max(session aggregate, per-message sum)`.
6. Bump `"version"` in `plugins/session-tokens/package.json` to `2.1.0`.
7. Build: from `/app` run `npm run build` (runs each workspace's `build`; this plugin's
   build is `rm -rf dist && mkdir -p dist && cp index.ts dist/tui.tsx`). Expect exit
   code 0 and `plugins/session-tokens/dist/tui.tsx` present.
8. Optional packaging check: `npm run pack:dry` (must list `dist/tui.tsx` and
   `README.md`, version 2.1.0).

## Tests and verification

There is no test infrastructure in this repo; verification is build + manual TUI checks.

1. **Build** — `npm run build` succeeds; `plugins/session-tokens/dist/tui.tsx` contains
   the `(other)` logic.
2. **Delta reconciliation (the bug case)** — install the local build into a dev
   OpenCode 2 config (or bump the global `cli.json` entry to the local path), start
   `opencode` in a scratch directory, send one short prompt, wait for the response and
   the auto-generated title, then open the sidebar widget:
   - Expected: a `(other)` row with a small token count (tens of tokens, ~45 in the
     reported case) and `Main == qwen… + (other)` exactly.
   - If cost display is active for paid models, `(other)` shows the cost delta too.
3. **No-delta sessions** — a resumed old session where aggregate equals breakdown must
   render with NO `(other)` row (guard is `otherTokens > 0 || otherCost > 0`).
4. **Subagents unaffected** — run a task that spawns a subagent; `Subagents` total must
   still equal the sum of its `@ agent` rows, and the header total must equal
   `Main + Subagents`.
5. **Truncation interaction** — with >10 distinct models (hard to hit naturally; may be
   skipped), `(other)` sorts by size and may fall into `+N more`; acceptable.

## Risks and open questions

- **Mid-turn flicker:** `session.tokens` patches on usage events while the message
  store syncs separately, so during an active turn `(other)` can transiently grow
  (message tokens lagging) or vanish (aggregate lagging, then Main jumps to the
  breakdown sum via `Math.max`). Cosmetic, self-heals on the next sync. Accepted.
- **Label wording:** `(other)` is intentionally vague because the true source (title
  model ID, summary calls) is not exposed to the TUI. Alternatives considered:
  `(session overhead)`, `(system)`. `(other)` chosen as the shortest honest label; easy
  to change later (single string literal).
- **Behavior change for stale aggregate:** previously Main could be *lower* than the
  row sum when the aggregate lagged messages; now Main rises to the row sum. This is
  the same reconciliation principle applied in both directions; no known consumer
  depends on the old under-report.
- **Sorting a synthetic row among real models:** `(other)` can, in theory, outrank a
  tiny real-model row. Judged acceptable (and more honest than pinning it last with a
  special case).
- **No automated regression test** can be added cheaply (no harness, plugin logic is
  inline in a Solid component reading store data). If a harness is introduced later,
  the reconciliation math is the first candidate for extraction into a pure function.
