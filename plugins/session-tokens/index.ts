/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, For, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const MAX_MODEL_ROWS = 10

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function spentTokenCount(tokens: any): number {
  const input = safeNumber(tokens?.input)
  const output = safeNumber(tokens?.output)
  const reasoning = safeNumber(tokens?.reasoning)
  const cacheWrite = safeNumber(tokens?.cache?.write)
  return input + output + reasoning + cacheWrite
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}

function shortModelLabel(label: string): string {
  if (label.length <= 28) return label
  return `${label.slice(0, 25)}...`
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const [open, setOpen] = createSignal(false)
  const theme = () => props.api.theme.current
  const messages = createMemo(() => props.api.state.session.messages(props.sessionID) as any[])
  const session = createMemo(() => props.api.state.session.get(props.sessionID) as any)

  const data = createMemo(() => {
    const totals = new Map<string, number>()
    let breakdownTotal = 0
    const seen = new Set<string>()

    for (const message of messages()) {
      const role = message?.role ?? message?.info?.role
      if (role !== "assistant") continue
      if (safeNumber(message?.tokens?.output) <= 0) continue

      const messageID = message?.id
      if (typeof messageID === "string" && seen.has(messageID)) continue
      if (typeof messageID === "string") seen.add(messageID)

      const count = spentTokenCount(message?.tokens)
      if (count <= 0) continue

      const modelID = message?.modelID ?? message?.info?.modelID ?? "unknown"

      breakdownTotal += count
      totals.set(modelID, (totals.get(modelID) ?? 0) + count)
    }

    const perModel = [...totals.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens)

    const sessionTotal = spentTokenCount(session()?.tokens)
    const total = breakdownTotal > 0 ? breakdownTotal : sessionTotal

    return {
      total,
      perModel,
    }
  })

  const show = createMemo(() => data().total > 0)
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
          <text fg={theme().textMuted}>{formatInt(data().total)}</text>
        </box>

        <Show when={canExpand() && open()}>
          <For each={data().perModel.slice(0, MAX_MODEL_ROWS)}>{(row) => (
            <box flexDirection="row">
              <text fg={theme().textMuted}>{shortModelLabel(row.model)}</text>
              <box flexGrow={1} />
              <text fg={theme().textMuted}>{formatInt(row.tokens)}</text>
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

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 120,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "streetturtle.session-tokens",
  tui,
}

export default plugin
