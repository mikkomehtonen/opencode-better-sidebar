/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

const MAX_MODEL_ROWS = 10
const INT_FORMATTER = new Intl.NumberFormat("en-US")

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

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const [open, setOpen] = createSignal(false)
  const theme = () => props.api.theme.current
  const messages = createMemo(() => props.api.state.session.messages(props.sessionID) as any[])
  const session = createMemo(() => props.api.state.session.get(props.sessionID) as any)

  const data = createMemo(() => {
    const tokenTotals = new Map<string, number>()
    const costTotals = new Map<string, number>()
    let breakdownTokenTotal = 0
    let breakdownCostTotal = 0
    let hasBreakdownCost = false
    const seen = new Set<string>()

    for (const message of messages()) {
      const role = message?.role ?? message?.info?.role
      if (role !== "assistant") continue

      const messageID = message?.id
      if (typeof messageID === "string" && seen.has(messageID)) continue
      if (typeof messageID === "string") seen.add(messageID)

      const tokenCount = spentTokenCount(message?.tokens)
      const messageCost = readCost(message)
      if (tokenCount <= 0 && !messageCost.present) continue

      const modelID = message?.modelID ?? message?.info?.modelID ?? "unknown"

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

    const perModel = [...new Set([...tokenTotals.keys(), ...costTotals.keys()])]
      .map((model) => ({
        model,
        tokens: tokenTotals.get(model) ?? 0,
        cost: costTotals.get(model) ?? 0,
      }))
      .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)

    const sessionTokenTotal = spentTokenCount(session()?.tokens)
    const sessionCost = readCost(session())
    // The message list exposed by the TUI state is capped to the most recent
    // 100 messages, so the per-message breakdown shrinks once a session grows
    // past that window. The session aggregate is cumulative across all
    // messages, so prefer it whenever it carries any usage.
    const totalTokens = sessionTokenTotal > 0 ? sessionTokenTotal : breakdownTokenTotal
    const totalCost = sessionCost.present ? sessionCost.value : breakdownCostTotal
    const hasCost = sessionCost.present || hasBreakdownCost
    const hasPerModelCost = costTotals.size > 0

    return {
      totalTokens,
      totalCost,
      hasCost,
      hasPerModelCost,
      perModel,
    }
  })

  const show = createMemo(() => data().totalTokens > 0 || data().hasCost)
  const canExpand = createMemo(() => data().perModel.length > 0)

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => canExpand() && setOpen((x) => !x)}>
          <Show when={canExpand()}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Session Tokens</b>
          </text>
          <text fg={theme().textMuted}>{formatInt(data().totalTokens)}</text>
          <Show when={data().hasCost}>
            <text fg={theme().textMuted}> ({formatMoney(data().totalCost)})</text>
          </Show>
        </box>

        <Show when={canExpand() && open()}>
          <For each={data().perModel.slice(0, MAX_MODEL_ROWS)}>{(row) => (
            <box flexDirection="row">
              <text fg={theme().textMuted}>{shortModelLabel(row.model)}</text>
              <box flexGrow={1} />
              <text fg={theme().textMuted}>{formatModelTotals(row.tokens, row.cost, data().hasPerModelCost)}</text>
            </box>
          )}</For>
          <Show when={data().perModel.length > MAX_MODEL_ROWS}>
            <text fg={theme().textMuted}>+{data().perModel.length - MAX_MODEL_ROWS} more</text>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

const main: TuiPlugin = async (api) => {
  api.slots.register({
    order: 120,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

export default { id: "streetturtle.session-tokens", tui: main }
