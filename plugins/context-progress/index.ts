/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"

// V2 API facts verified against @opencode/plugin@2.2.6 shipped .d.ts (2026-11-07):
// - Plugin.define({ id, setup(ctx) }) from "@opencode/plugin/tui"; usePlugin() returns
//   the same Context inside slot JSX. setup may return a cleanup fn.
// - ui.slot({ append: "sidebar.content", render: ({ sessionID }) => ... }) returns an
//   unregister fn. Slot input is { sessionID: string } (SlotMap["sidebar.content"]).
// - data.session.message.list(id): SessionMessageInfo[]; sync(id): Promise<void>.
//   The solid data store is event-driven and self-refreshes, so memos update without
//   manual data.listen()/invalidate().
// - data.session.cost(id): number (plain USD number, MoneyUSD = number).
// - Assistant message shape: { type: "assistant", model: { id, providerID },
//   tokens?: { input, output, reasoning, cache: { read, write } }, cost?: number }.
// - data.location.model.list(location): ModelInfo[] | undefined with entries
//   { providerID, modelID, limit: { context, output } }.
// - context.theme: ResolvedTheme (@opencode/theme/tui) — tokens are RGBA values
//   (pass straight to `fg`): text.base, text.muted, hue.accent[100..900],
//   text.feedback.{error,warning,success,info}.base.

const BAR_WIDTH = 24

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function readCost(source: any): number {
  const candidates = [
    source?.cost,
    source?.info?.cost,
    source?.usage?.cost,
    source?.metrics?.cost,
  ]
  for (const c of candidates) {
    const n = typeof c === "number" ? c : typeof c === "string" && c !== "" ? Number(c) : NaN
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function messageTokenCount(message: any): number {
  const input = safeNumber(message?.tokens?.input)
  const output = safeNumber(message?.tokens?.output)
  const reasoning = safeNumber(message?.tokens?.reasoning)
  const cacheRead = safeNumber(message?.tokens?.cache?.read)
  const cacheWrite = safeNumber(message?.tokens?.cache?.write)
  return input + output + reasoning + cacheRead + cacheWrite
}

function buildBar(percent: number): { bar: string; clamped: number } {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((clamped / 100) * BAR_WIDTH)))
  return {
    bar: `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}`,
    clamped,
  }
}

function View(props: { sessionID: string }) {
  const context = usePlugin()

  // Prime the message and model catalogs on mount / session switch.
  createEffect(() => {
    void context.data.session.message.sync(props.sessionID)
    const location = context.location ?? context.data.location.default()
    void context.data.location.model.sync(location)
  })

  const messages = createMemo(
    () => (context.data.session.message.list(props.sessionID) ?? []) as any[],
  )

  const sessionCost = createMemo(() => {
    const direct = safeNumber(context.data.session.cost(props.sessionID))
    if (direct > 0) return direct

    const fromSession = readCost(context.data.session.get(props.sessionID))
    if (fromSession > 0) return fromSession

    return messages()
      .filter((m) => (m?.type ?? m?.role ?? m?.info?.role) === "assistant")
      .reduce((sum, m) => sum + readCost(m), 0)
  })

  const usage = createMemo(() => {
    const lastAssistant = messages().findLast((m) => {
      const kind = m?.type ?? m?.role ?? m?.info?.role
      const output = safeNumber(m?.tokens?.output)
      return kind === "assistant" && output > 0
    })

    if (!lastAssistant) {
      return {
        tokens: 0,
        contextWindow: 0,
        percent: 0,
      }
    }

    const tokens = messageTokenCount(lastAssistant)
    const providerID =
      lastAssistant?.model?.providerID ?? lastAssistant?.providerID ?? lastAssistant?.info?.providerID
    const modelID = lastAssistant?.model?.id ?? lastAssistant?.modelID ?? lastAssistant?.info?.modelID

    const location = context.location ?? context.data.location.default()
    const models = context.data.location.model.list(location) ?? []
    const model = models.find(
      (item) => item.providerID === providerID && item.modelID === modelID,
    )
    const contextWindow = safeNumber(model?.limit?.context)
    const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0

    return {
      tokens,
      contextWindow,
      percent,
    }
  })

  const detailLine = createMemo(() => {
    const state = usage()
    const limitText = state.contextWindow > 0 ? formatInt(state.contextWindow) : "--"
    return `${formatInt(state.tokens)} / ${limitText} / ${formatMoney(sessionCost())}`
  })

  const theme = createMemo(() => {
    const current = context.theme
    return {
      text: current.text.base,
      muted: current.text.muted,
      accent: current.hue.accent[500] ?? current.text.base,
      warning: current.text.feedback.warning.base,
      error: current.text.feedback.error.base,
    }
  })

  const progress = createMemo(() => {
    const percent = usage().percent
    const bar = buildBar(percent)
    const colors = theme()
    const color = percent >= 90 ? colors.error : percent >= 70 ? colors.warning : colors.accent
    return {
      bar: bar.bar,
      color,
      percent: bar.clamped,
    }
  })

  return (
    <box>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>Context</text>
      <box flexDirection="row" gap={1}>
        <text fg={progress().color}>{progress().bar}</text>
        <text fg={progress().color}> {progress().percent}%</text>
      </box>
      <text fg={theme().muted}>{detailLine()}</text>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.context-progress",
  setup(context) {
    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <View sessionID={input.sessionID} />,
    })

    return () => stopSlot()
  },
})
