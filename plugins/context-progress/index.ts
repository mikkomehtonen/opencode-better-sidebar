/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"

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

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const messages = createMemo(() => props.api.state.session.messages(props.sessionID) as any[])
  const sessionCost = createMemo(() => {
    const sessionState = (props.api.state as any)?.session
    const fromState = safeNumber(sessionState?.get?.(props.sessionID)?.cost)
    if (fromState > 0) return fromState

    return messages()
      .filter((m) => (m?.role ?? m?.info?.role) === "assistant")
      .reduce((sum, m) => sum + safeNumber(m?.cost), 0)
  })

  const usage = createMemo(() => {
    const lastAssistant = messages().findLast((m) => {
      const role = m?.role ?? m?.info?.role
      const output = safeNumber(m?.tokens?.output)
      return role === "assistant" && output > 0
    })

    if (!lastAssistant) {
      return {
        tokens: 0,
        contextWindow: 0,
        percent: 0,
      }
    }

    const tokens = messageTokenCount(lastAssistant)
    const providerID = lastAssistant?.providerID ?? lastAssistant?.info?.providerID
    const modelID = lastAssistant?.modelID ?? lastAssistant?.info?.modelID
    const model = props.api.state.provider.find((item) => item.id === providerID)?.models?.[modelID]
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

  const theme = () => props.api.theme.current

  const progress = createMemo(() => {
    const percent = usage().percent
    const bar = buildBar(percent)
    const color = percent >= 90 ? theme().error : percent >= 70 ? theme().warning : theme().accent
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
      <text fg={theme().textMuted}>{detailLine()}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const { slots } = api

  slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "streetturtle.context-progress",
  tui,
}

export default plugin
