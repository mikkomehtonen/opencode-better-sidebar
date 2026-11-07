# Plan: Persist session-tokens expansion state across view transitions

## Context & Goals

**Bug:** In `/app/plugins/session-tokens/index.ts`, the `View` component holds its expansion state in a local signal:

```ts
// line 145
const [open, setOpen] = createSignal(false)
```

When the user navigates into a subagent view and back, the TUI unmounts/remounts the sidebar `View` for the parent session (slot `sidebar_content`, registered at line 345–347 with `props.session_id`). The new `View` instance re-runs `createSignal(false)`, so the token list collapses even though the user had it expanded.

**Goal:** Expansion state must survive remounts, scoped per `session_id`.

**Approach (per constraints):** a module-level `Map<string, boolean>` keyed by session ID as the durable source of truth; the per-`View` signal becomes a reactive view initialized from the Map, and the toggle handler writes through to the Map. All changes stay inside `/app/plugins/session-tokens/index.ts`.

## Changes (single file: `/app/plugins/session-tokens/index.ts`)

### Step 1 — Add module-level state (after the constants, ~line 6)

```ts
const MAX_MODEL_ROWS = 10
const INT_FORMATTER = new Intl.NumberFormat("en-US")
const expandedBySession = new Map<string, boolean>()
```

### Step 2 — Initialize the `open` signal from the Map (line 145)

Before:

```ts
const [open, setOpen] = createSignal(false)
```

After:

```ts
const [open, setOpen] = createSignal(expandedBySession.get(props.sessionID) ?? false)
```

### Step 3 — Write-through in the toggle handler (line 287)

Before:

```tsx
<box onMouseDown={() => canExpand() && setOpen((x) => !x)}>
```

After:

```tsx
<box
  onMouseDown={() => {
    if (!canExpand()) return
    const next = !open()
    expandedBySession.set(props.sessionID, next)
    setOpen(next)
  }}
>
```

Notes:

- The `canExpand()` guard is preserved: a non-expandable header performs no write (same semantics as today, where `setOpen` is only called when `canExpand()` is true).
- The signal is still required because the JSX reads `open()` reactively at line 289 (▼/▶ glyph) and line 297 (`<Show when={canExpand() && open()}>`). A bare Map read is not reactive in SolidJS, so the signal remains the reactive mirror; the Map is the durable store.
- No other references to `open`/`setOpen` exist in the file (verified: lines 145, 287, 289, 297 only).

## Why this satisfies the Definition of Done

- **Persists across view transitions:** on remount, `createSignal(expandedBySession.get(props.sessionID) ?? false)` restores the last known state for that session.
- **Scoped per session:** the Map is keyed by `props.sessionID` (the slot passes `props.session_id`, line 346). Each session has an independent entry; navigating between sessions or toggling one session never affects another. Sessions never seen expanded default to `false` (collapsed), matching current first-mount behavior.

## Risks / Rollback

| Risk | Assessment |
|---|---|
| Unbounded Map growth (one boolean per session per process lifetime) | Negligible for a TUI process; adding eviction would violate the minimal-change constraint. Accepted. |
| Stale state if a session ID were ever reused for a different session | Session IDs are unique identifiers (UUIDs); not a practical concern. |
| Behavior change: expansion now persists across remounts | This is the intended fix, not a regression. |
| Concurrent `View` instances for the same session (if the TUI ever renders two) | Both would read/write the same Map entry; last toggle wins — acceptable, no crash risk. |

**Rollback:** single-file, three-line change; revert the file (git checkout) to restore the original `createSignal(false)` behavior.

## Testing & Verification Playbook

The repo has no tsconfig and the plugin build is a plain copy (`npm run build` → `cp index.ts dist/tui.tsx`), so there is no typecheck gate. Verification:

1. **Syntax/parse check** (no deps installed in workspace; esbuild parses TSX without resolving imports):
   ```sh
   npx -y esbuild plugins/session-tokens/index.ts --loader:.ts=tsx --jsx=automatic --outfile=/dev/null
   ```
2. **Build check:**
   ```sh
   npm run build --workspace @streetturtle/opencode-session-tokens
   ```
   Confirm `dist/tui.tsx` is regenerated and contains the new `expandedBySession` lines.
3. **Diff review:** confirm the only touched lines are the new module constant, line 145, and the `onMouseDown` handler at line 287.
4. **Manual TUI verification** (requires an OpenCode instance with the plugin loaded):
   - Open a session with token data; click the header to expand (▶ → ▼, per-model rows visible).
   - Navigate into a subagent view, then back to the parent session.
   - **Expect:** list remains expanded (▼) with rows visible — the bug is fixed.
   - Collapse it (▼ → ▶), navigate away and back. **Expect:** stays collapsed.
   - Open a different session. **Expect:** its list starts collapsed (per-session scoping).
   - Toggle session A expanded, switch to session B and back. **Expect:** A still expanded, B independent.

## Acceptance Criteria

- [ ] Expansion state persists across view transitions for the same session (expand → navigate to subagent view → return: list stays expanded).
- [ ] State is correctly scoped to individual sessions (each `session_id` has independent expansion state; unexpanded sessions default to collapsed).
- [ ] Change is confined to `/app/plugins/session-tokens/index.ts` (module-level `Map<string, boolean>` + signal initialization + toggle handler write-through).
- [ ] `canExpand()` guard preserved: non-expandable headers do not write to the Map.
- [ ] `npm run build` for the plugin succeeds; esbuild TSX parse check passes.
