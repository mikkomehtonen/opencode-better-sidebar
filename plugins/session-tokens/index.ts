/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"

// V2 API facts verified against @opencode/plugin@2.2.6 shipped .d.ts + store source (2026-11-08):
// - client.session.children is gone; V2 lists descendants via client.session.list({ parentID })
//   (the solid store itself does exactly this internally to seed family trees).
// - The reactive data store maintains a family index per root session: every session registered
//   via session.sync()/session.created is linked through its parentID chain, so
//   data.session.family(id) (a reactive read) yields every loaded session under the same root —
//   including the queried session itself. Subagents are therefore found by walking parentID
//   links over loaded family members — no createResource/event-watch refetch loop needed.
// - Do NOT use data.session.cost(id): for root sessions it aggregates root + entire family and
//   would double-count the subagent rows summed below. Record-level data.session.get(id).cost
//   and .tokens are per-session aggregates (session.usage.updated patches them live).
// - Historical children (created in previous runs) are not in the store when a session opens,
//   so one seeding pass recursively lists children by parentID and sync()s unknown ids; it is
//   re-run when the message list changes (V1 used the same trigger for its refetch).
// - Message shape: assistant records carry tokens/cost?/model: { id, providerID } (discriminator
//   is `type`); SessionInfo.tokens is always present (TokenUsageInfo) and cost defaults to 0, so
//   "present" still means > 0.
// - Theme tokens: text.base / text.muted (V1: theme.text / theme.textMuted).

const MAX_MODEL_ROWS = 10
const INT_FORMATTER = new Intl.NumberFormat("en-US")
const CHILD_PAGE_LIMIT = 200
const CHILD_PAGE_CAP = 10

const expansionStateBySession = new Map<string, boolean>()

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function hasNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value > 0
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0
  }
  return false
}

function readCost(source: any): { value: number; present: boolean } {
  const candidates = [
    source?.cost,
    source?.info?.cost,
    source?.usage?.cost,
    source?.metrics?.cost,
  ]

  for (const candidate of candidates) {
    if (hasNumeric(candidate)) {
      return {
        value: safeNumber(candidate),
        present: true,
      }
    }
  }

  return {
    value: 0,
    present: false,
  }
}

function spentTokenCount(tokens: any): number {
  const input = safeNumber(tokens?.input)
  const output = safeNumber(tokens?.output)
  const reasoning = safeNumber(tokens?.reasoning)
  const cacheWrite = safeNumber(tokens?.cache?.write)
  return input + output + reasoning + cacheWrite
}

function formatInt(value: number): string {
  return INT_FORMATTER.format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
  const v = Math.max(0, value)
  if (v === 0) return "$0.00"
  if (v < 0.01) return "<$0.01"
  if (v < 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(2)}`
}

function formatModelTotals(tokens: number, cost: number, showCost: boolean): string {
  if (showCost && cost > 0) return `${formatInt(tokens)} (${formatMoney(cost)})`
  return formatInt(tokens)
}

function shortModelLabel(label: string): string {
  const MAX = 28
  if (label.length <= MAX) return label
  const lastSlash = label.lastIndexOf("/")
  const suffix = lastSlash >= 0 ? label.slice(lastSlash + 1) : label
  if (suffix.length <= MAX - 3) return `...${suffix}`
  return `...${suffix.slice(suffix.length - (MAX - 3))}`
}

function isSubagentSession(session: any): boolean {
  if (!session || typeof session.id !== "string") return false
  if (typeof session.parentID !== "string" || session.parentID === "") return false
  // Only descendants launched as subagents count (children with an `agent`), so forked
  // sessions are excluded.
  if (typeof session.agent !== "string" || session.agent === "") return false
  if (session.fork) return false
  return true
}

async function listChildSessions(client: any, parentID: string): Promise<any[]> {
  const collected: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < CHILD_PAGE_CAP; page++) {
    let response: any
    try {
      response = await client.session.list({
        parentID,
        order: "desc",
        limit: CHILD_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })
    } catch {
      break
    }
    collected.push(...(response?.data ?? []))
    cursor = response?.cursor?.next ?? undefined
    if (!cursor) break
  }
  return collected
}

// Seed the reactive store with subagent sessions created in earlier runs so the family
// index (and every reactive read below) can see them. Sessions created during this run
// arrive on their own via session.created events.
async function seedSubagentSessions(context: ReturnType<typeof usePlugin>, sessionID: string): Promise<void> {
  const seen = new Set<string>()
  const walk = async (parentID: string): Promise<void> => {
    if (seen.has(parentID)) return
    seen.add(parentID)
    for (const child of await listChildSessions(context.client, parentID)) {
      if (!isSubagentSession(child)) continue
      if (!context.data.session.get(child.id)) {
        await Promise.resolve(context.data.session.sync(child.id)).catch(() => {})
      }
      await walk(child.id)
    }
  }
  await walk(sessionID)
}

function View(props: { sessionID: string }) {
  const context = usePlugin()
  // Expanded by default; the Map remembers an explicit collapse (or re-expand) per session.
  const [open, setOpen] = createSignal(expansionStateBySession.get(props.sessionID) ?? true)
  const theme = createMemo(() => {
    const current = context.theme
    return {
      text: current.text.base,
      muted: current.text.muted,
    }
  })

  const messages = createMemo(() => (context.data.session.message.list(props.sessionID) ?? []) as any[])

  // Prime the message cache on mount / session switch.
  createEffect(() => {
    void context.data.session.message.sync(props.sessionID)
  })

  let seeding = false
  const seedSubagents = () => {
    if (seeding) return
    seeding = true
    void Promise.resolve(seedSubagentSessions(context, props.sessionID)).finally(() => {
      seeding = false
    })
  }

  // Historical-hydration pass, re-run whenever the transcript grows (V1 refetched its child
  // tree on the same trigger). Live updates need no polling: the store patches cost/tokens
  // from session.usage.updated events and registers new sessions from session.created.
  createEffect(() => {
    // Any transcript change re-runs the historical-hydration pass; no signature diffing
    // needed since messages() itself is the dependency.
    messages()
    seedSubagents()
  })

  // Reactive subagent tree: walk parentID links over sessions loaded in the family index,
  // keeping only agent-launched children and recursing solely into those.
  const subagents = createMemo(() => {
    const family = context.data.session.family(props.sessionID) ?? []
    const childrenByParent = new Map<string, any[]>()
    for (const id of family) {
      if (id === props.sessionID) continue
      const info: any = context.data.session.get(id)
      if (!isSubagentSession(info)) continue
      const siblings = childrenByParent.get(info.parentID)
      if (siblings) siblings.push(info)
      else childrenByParent.set(info.parentID, [info])
    }

    const collected: any[] = []
    const seen = new Set<string>([props.sessionID])
    const queue: string[] = [props.sessionID]
    while (queue.length > 0) {
      const parentID = queue.shift()!
      for (const child of childrenByParent.get(parentID) ?? []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        collected.push(child)
        queue.push(child.id)
      }
    }
    return collected
  })

  const data = createMemo(() => {
    const children = subagents()
    const tokenTotals = new Map<string, number>()
    const costTotals = new Map<string, number>()
    let breakdownTokenTotal = 0
    let breakdownCostTotal = 0
    let hasBreakdownCost = false
    const seen = new Set<string>()

    for (const message of messages()) {
      const role = message?.type ?? message?.role ?? message?.info?.role
      if (role !== "assistant") continue

      const messageID = message?.id
      if (typeof messageID === "string" && seen.has(messageID)) continue
      if (typeof messageID === "string") seen.add(messageID)

      const tokenCount = spentTokenCount(message?.tokens)
      const messageCost = readCost(message)
      if (tokenCount <= 0 && !messageCost.present) continue

      const modelID = message?.model?.id ?? message?.modelID ?? message?.info?.modelID ?? "unknown"

      if (tokenCount > 0) {
        breakdownTokenTotal += tokenCount
        tokenTotals.set(modelID, (tokenTotals.get(modelID) ?? 0) + tokenCount)
      }

      if (messageCost.present) {
        hasBreakdownCost = true
        breakdownCostTotal += messageCost.value
        costTotals.set(modelID, (costTotals.get(modelID) ?? 0) + messageCost.value)
      }
    }

    // Record-level (own) aggregates — data.session.cost() would fold the family in and
    // double-count the subagent rows summed below.
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

    const subagentTokenTotals = new Map<string, number>()
    const subagentCostTotals = new Map<string, number>()
    let subagentTokens = 0
    let subagentCost = 0
    let hasSubagentCost = false

    for (const child of children) {
      const childTokens = spentTokenCount(child?.tokens)
      const childCost = readCost(child)
      if (childTokens <= 0 && !childCost.present) continue
      const agent = typeof child?.agent === "string" && child.agent ? child.agent : "subagent"
      if (childTokens > 0) {
        subagentTokens += childTokens
        subagentTokenTotals.set(agent, (subagentTokenTotals.get(agent) ?? 0) + childTokens)
      }
      if (childCost.present) {
        hasSubagentCost = true
        subagentCost += childCost.value
        subagentCostTotals.set(agent, (subagentCostTotals.get(agent) ?? 0) + childCost.value)
      }
    }

    const subagentByAgent = [...new Set([...subagentTokenTotals.keys(), ...subagentCostTotals.keys()])]
      .map((agent) => ({
        agent,
        tokens: subagentTokenTotals.get(agent) ?? 0,
        cost: subagentCostTotals.get(agent) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)

    const hasSubagents = subagentTokens > 0 || hasSubagentCost
    const hasCost = sessionCost.present || hasBreakdownCost || hasSubagentCost
    const hasPerModelCost = costTotals.size > 0 || otherCost > 0

    return {
      totalTokens: mainTokens + subagentTokens,
      totalCost: mainCost + subagentCost,
      mainTokens,
      mainCost,
      hasCost,
      hasPerModelCost,
      perModel,
      hasSubagents,
      subagentTokens,
      subagentCost,
      hasSubagentCost,
      subagentByAgent,
    }
  })

  const show = createMemo(() => data().totalTokens > 0 || data().hasCost)
  const canExpand = createMemo(() => data().perModel.length > 0 || data().hasSubagents)

  return (
    <Show when={show()}>
      <box>
        <box
          onMouseDown={() => {
            if (!canExpand()) return
            const next = !open()
            expansionStateBySession.set(props.sessionID, next)
            setOpen(next)
          }}
        >
          <text fg={theme().text}>
            {canExpand() ? (open() ? "▼" : "▶") + " " : ""}
            <b>Session Tokens</b>
            <span style={{ fg: theme().muted }}>{` ${formatInt(data().totalTokens)}`}</span>
            {data().hasCost ? <span style={{ fg: theme().muted }}> ({formatMoney(data().totalCost)})</span> : ""}
            {data().hasSubagents ? <span style={{ fg: theme().muted }}> · incl. subagents</span> : ""}
          </text>
        </box>

        <Show when={canExpand() && open()}>
          <Show when={data().hasSubagents && data().perModel.length > 0}>
            <box flexDirection="row">
              <text fg={theme().muted}>Main</text>
              <box flexGrow={1} />
              <text fg={theme().muted}>{formatModelTotals(data().mainTokens, data().mainCost, data().hasCost)}</text>
            </box>
          </Show>
          <For each={data().perModel.slice(0, MAX_MODEL_ROWS)}>{(row) => (
            <box flexDirection="row">
              <text fg={theme().muted}>{shortModelLabel(row.model)}</text>
              <box flexGrow={1} />
              <text fg={theme().muted}>{formatModelTotals(row.tokens, row.cost, data().hasPerModelCost)}</text>
            </box>
          )}</For>
          <Show when={data().perModel.length > MAX_MODEL_ROWS}>
            <text fg={theme().muted}>+{data().perModel.length - MAX_MODEL_ROWS} more</text>
          </Show>

          <Show when={data().hasSubagents}>
            <box flexDirection="row">
              <text fg={theme().text}>
                <b>Subagents</b>
              </text>
              <box flexGrow={1} />
              <text fg={theme().muted}>{formatModelTotals(data().subagentTokens, data().subagentCost, data().hasSubagentCost)}</text>
            </box>
            <For each={data().subagentByAgent.slice(0, MAX_MODEL_ROWS)}>{(row) => (
              <box flexDirection="row">
                <text fg={theme().muted}>@ {row.agent}</text>
                <box flexGrow={1} />
                <text fg={theme().muted}>{formatModelTotals(row.tokens, row.cost, data().hasSubagentCost)}</text>
              </box>
            )}</For>
            <Show when={data().subagentByAgent.length > MAX_MODEL_ROWS}>
              <text fg={theme().muted}>+{data().subagentByAgent.length - MAX_MODEL_ROWS} more</text>
            </Show>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "streetturtle.session-tokens",
  setup(context) {
    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <View sessionID={input.sessionID} />,
    })

    return () => stopSlot()
  },
})
