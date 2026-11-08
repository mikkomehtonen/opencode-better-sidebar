# Remove "incl. subagents" suffix from session-tokens header

## Objective and requirements

The `session-tokens` TUI sidebar plugin appends ` · incl. subagents` to its
"Session Tokens" header whenever the session tree has subagent usage. This
suffix adds little informational value and makes the header long enough that
it wraps onto a second row in narrow sidebars.

Requirement: remove the ` · incl. subagents` text from the header entirely.
Nothing else about the header (expand arrow, "Session Tokens" title, token
count, cost) or the expanded subagent breakdown should change.

## Relevant existing architecture

- Plugin source: `plugins/session-tokens/index.ts` (plugin id
  `streetturtle.session-tokens`, package `@streetturtle/opencode-session-tokens`).
  It is a SolidJS/JSX TUI sidebar plugin rendering a collapsible "Session
  Tokens" panel with per-model breakdown and a `Subagents` section.
- The header is rendered in a single `<text>` block (`index.ts:351-357`):

  ```tsx
  351:           <text fg={theme().text}>
  352:             {canExpand() ? (open() ? "▼" : "▶") + " " : ""}
  353:             <b>Session Tokens</b>
  354:             <span style={{ fg: theme().muted }}>{` ${formatInt(data().totalTokens)}`}</span>
  355:             {data().hasCost ? <span style={{ fg: theme().muted }}> ({formatMoney(data().totalCost)})</span> : ""}
  356:             {data().hasSubagents ? <span style={{ fg: theme().muted }}> · incl. subagents</span> : ""}
  357:           </text>
  ```

- The string is a plain JSX literal inside a conditional `<span>` on **line
  356** — no template concatenation, no other code paths build it.
- `hasSubagents` (defined at `index.ts:317`, returned from the `data()` memo at
  line 329) is used in three other places that must keep working:
  - `index.ts:338` — `canExpand()` memo (expand/collapse toggle),
  - `index.ts:361` — `<Show when={data().hasSubagents && data().perModel.length > 0}>` ("Main" row),
  - `index.ts:382` — `<Show when={data().hasSubagents}>` ("Subagents" section).

  So the field itself stays; only the header span is removed.
- The other plugins in `plugins/` (`context-progress`, `open-in`, `recap`)
  contain no "incl." suffix — `session-tokens` is the only place to change.
- Other occurrences of the string are historical documentation only
  (`plans/upgrade-session-tokens-v2.md:110,115`). Do not edit those; they
  record past behavior at the time of that upgrade pass.
- There are no tests or snapshots referencing this string.

## Proposed implementation

Delete line 356 of `plugins/session-tokens/index.ts` — the entire conditional
span `{data().hasSubagents ? <span ...> · incl. subagents</span> : ""}`.

Deleting the whole line (rather than gutting the expression) is the clean
removal: when `hasSubagents` is true the ` · ` prefix disappears along with the
text, and when false the expression already rendered `""`. No trailing spaces,
dangling separators, or orphaned JSX. The header becomes:

```
▼ Session Tokens 16,792 ($0.04)
```

for sessions with subagents (identical to sessions without them).

## Files that need modification

- `plugins/session-tokens/index.ts` — delete line 356 (one-line removal).

No changes to `package.json`, `README.md`, or any other plugin.

## Step-by-step implementation instructions

1. Open `plugins/session-tokens/index.ts`.
2. Locate the header `<text>` block (around lines 351-357) containing
   `<b>Session Tokens</b>`.
3. Delete the entire line:

   ```tsx
   {data().hasSubagents ? <span style={{ fg: theme().muted }}> · incl. subagents</span> : ""}
   ```

   Leave lines 351-355 and 357 intact. Do not touch the `hasSubagents` memo,
   the `canExpand()` memo, or the `<Show when={data().hasSubagents...}>` blocks.
4. Confirm no other occurrence remains in plugin code:
   `rg -in "incl\. subagents" plugins/` must return nothing.
5. If the repo/package defines a typecheck or build script for the plugin
   (check `plugins/session-tokens/package.json`), run it to confirm the file
   still compiles. Do not add new scripts or dependencies.

## Tests and verification

- No automated tests exist for this plugin; verification is manual + static:
  1. Typecheck/build (if a script exists) passes.
  2. `rg -in "incl\. subagents" plugins/` → 0 matches.
  3. Launch the TUI with the plugin loaded, open a session that has subagent
     usage, and confirm:
     - Header shows `Session Tokens <count> (<cost>)` with **no** `incl.
       subagents` suffix and no stray ` · ` separator.
     - The header no longer wraps to a second row in a narrow sidebar.
     - Expanding still shows the "Main" row and the "Subagents" section, and
       the ▶/▼ toggle still appears (`canExpand()` still considers subagents).
  4. Open a session **without** subagents and confirm the header is unchanged
     from before.

## Risks and open questions

- **Risk: minimal.** Single-line JSX removal; `hasSubagents` remains defined
  and used elsewhere, so no dead-code or unused-variable fallout.
- Header still wraps if the session id/token count alone exceed the panel
  width — out of scope; this change only removes the identified suffix.
- Publishing note: if the package version is bumped at release time for
  `@streetturtle/opencode-session-tokens`, that is handled by the maintainer's
  normal release flow — no version change is part of this edit.
- Historical plan docs (`plans/upgrade-session-tokens-v2.md`) intentionally
  keep the old string as a record of then-current behavior; leave them as-is.
