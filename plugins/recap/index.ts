/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, Show } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes } from "@opentui/core"

// V2 API facts verified against @opencode/plugin@2.2.6 shipped .d.ts + host binary (2026-11-07):
// - Plugin.define({ id, setup(ctx) }); usePlugin() inside slot JSX; plugin options come from
//   context.options (cli.json entries: { package, options }).
// - client.session.generate({ sessionID, prompt }): Promise<{ text }> — one-shot completion
//   that awaits the model, replacing V1's create → prompt → session.idle wait → re-fetch →
//   echo-filter dance. Promise client returns unwrapped data (session.create() returns
//   SessionInfo directly, not { data }); deletion is session.remove({ sessionID }).
// - Message shapes: user messages carry `text: string`; assistant messages carry
//   `content: Array<{ type: "text" | "reasoning" | "tool", ... }>` and `model: { id,
//   providerID }` — discriminator `type`, no info/parts wrappers.
// - Event payloads live under `.data` (V1: `.properties`). BUT the V1 names session.status
//   and session.idle are never emitted by the 2.2.6 server (dead in the type union). Live
//   prompt event sequence per prompt: session.inbox.enqueued → session.execution.started →
//   …steps/text… → session.usage.updated → session.execution.succeeded. The staleness
//   counter therefore uses session.execution.started (once per prompt).
// - SyntaxStyle.fromStyles(styles, owner) requires a NativeResourceOwner since OpenTUI 0.6 —
//   context.renderer.nativeScene provides one (the host itself builds theme syntax styles
//   with it). Theme syntax tokens moved from flat (syntaxComment) to nested (syntax.comment).
//   @opencode/theme/tui's generateSyntax() is NOT importable from plugins (the host's runtime
//   module map omits @opencode/theme), so keep the manual 9-token map via @opentui/core.
// - <markdown content syntaxStyle fg> props unchanged in OpenTUI 0.8.3.

const PROMPTS_UNTIL_STALE = 3
const RECENT_MESSAGES = 10
const RECAP_TIMEOUT_MS = 30_000

// Module-level signals so the View component reacts to changes
const recapSignals = new Map<string, ReturnType<typeof createSignal<string | null>>>()
const loadingSignals = new Map<string, ReturnType<typeof createSignal<boolean>>>()
// Counts user prompts sent after the last recap was generated
const promptCounters = new Map<string, number>()

type RecapOptions = {
  providerID?: string
  modelID?: string
}

type ModelChoice = {
  providerID: string
  modelID: string
}

function readConfiguredModel(options: RecapOptions | undefined): ModelChoice | undefined {
  const providerID = options?.providerID?.trim()
  const modelID = options?.modelID?.trim()

  const hasProvider = Boolean(providerID)
  const hasModel = Boolean(modelID)

  if (hasProvider !== hasModel) {
    throw new Error("Invalid recap plugin config: set both providerID and modelID, or neither")
  }

  if (!hasProvider || !hasModel) return

  return {
    providerID: providerID!,
    modelID: modelID!,
  }
}

function messageText(message: any): string | undefined {
  if (message?.type === "user") {
    return message.text?.trim() || undefined
  }
  if (message?.type === "assistant") {
    const text = (message.content ?? [])
      .filter((item: any) => item?.type === "text")
      .map((item: any) => item?.text ?? "")
      .join(" ")
      .trim()
    return text || undefined
  }
  return undefined
}

function buildTranscript(messages: any[]): string {
  return messages
    .map((message: any) => {
      const role = message?.type === "user" || message?.type === "assistant" ? message.type : undefined
      const text = messageText(message)
      return role && text ? `${role}: ${text}` : null
    })
    .filter(Boolean)
    .join("\n\n")
}

function inferSessionModel(messages: any[]): ModelChoice | undefined {
  const lastAssistant = [...messages]
    .reverse()
    .find(
      (m: any) =>
        m?.type === "assistant" &&
        typeof m?.model?.providerID === "string" &&
        typeof m?.model?.id === "string",
    )

  const providerID = lastAssistant?.model?.providerID?.trim?.() ?? ""
  const modelID = lastAssistant?.model?.id?.trim?.() ?? ""
  if (!providerID || !modelID) return

  return { providerID, modelID }
}

function getRecapSignal(sessionID: string) {
  if (!recapSignals.has(sessionID)) recapSignals.set(sessionID, createSignal<string | null>(null))
  return recapSignals.get(sessionID)!
}

function getLoadingSignal(sessionID: string) {
  if (!loadingSignals.has(sessionID)) loadingSignals.set(sessionID, createSignal<boolean>(false))
  return loadingSignals.get(sessionID)!
}

function buildSyntaxStyle(context: ReturnType<typeof usePlugin>): SyntaxStyle {
  const syntax = context.theme.syntax
  // The returned style owns native resources tied to the renderer's scene context; build it
  // from a memo (never per render) so theme changes are the only rebuild trigger.
  return SyntaxStyle.fromStyles(
    {
      comment: { fg: syntax.comment },
      keyword: { fg: syntax.keyword },
      function: { fg: syntax.function },
      variable: { fg: syntax.variable },
      string: { fg: syntax.string },
      number: { fg: syntax.number },
      type: { fg: syntax.type },
      operator: { fg: syntax.operator },
      punctuation: { fg: syntax.punctuation },
    },
    context.renderer.nativeScene,
  )
}

async function generateRecap(
  context: ReturnType<typeof usePlugin>,
  sessionID: string,
  config: { configuredModel?: ModelChoice; optionsError?: string },
) {
  const [, setRecap] = getRecapSignal(sessionID)
  const [, setLoading] = getLoadingSignal(sessionID)
  let recapSessionID: string | undefined
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  setLoading(true)

  const [currentRecap] = getRecapSignal(sessionID)
  const previousRecap = currentRecap()

  try {
    if (config.optionsError) {
      throw new Error(config.optionsError)
    }

    // Read only the most recent messages from the reactive cache.
    await context.data.session.message.sync(sessionID)
    const messages = (context.data.session.message.list(sessionID) ?? []).slice(-RECENT_MESSAGES)
    const transcript = buildTranscript(messages)

    if (!transcript) {
      setRecap("*Nothing to summarize yet.*")
      return
    }

    const modelToUse = config.configuredModel ?? inferSessionModel(messages)

    // Create a throwaway session for the LLM call; the model is set on the session itself.
    const created = await context.client.session.create(
      modelToUse ? { model: { id: modelToUse.modelID, providerID: modelToUse.providerID } } : {},
    )
    recapSessionID = created?.id
    if (!recapSessionID) throw new Error("Failed to create recap session")

    const prompt = `You are a summarization assistant. Output only Markdown - no tools, no files, no questions.
Do not use Markdown tables.

Summarize this coding session in ~40 words across these sections:

**Working on:** one sentence - what is being built or explored
**Done:** max 2 bullets, <=6 words each (skip if nothing yet)
**Next:** max 1 bullet - the immediate next step (skip if none)

No intro, no outro, no extra sections. Output only the Markdown.
Never use table syntax (no pipes or table separators).
${previousRecap ? `\nPREVIOUS RECAP (context for earlier history):\n${previousRecap}\n` : ""}
RECENT TRANSCRIPT (last ${RECENT_MESSAGES} messages):
${transcript}`

    const timeoutPromise = new Promise<never>((_, reject) =>
      timeoutHandle = setTimeout(() => reject(new Error("Recap timed out")), RECAP_TIMEOUT_MS)
    )

    // session.generate awaits the model turn and returns the assistant text directly.
    const result = await Promise.race([
      context.client.session.generate({ sessionID: recapSessionID, prompt }),
      timeoutPromise,
    ])

    const recapText = (result?.text ?? "").trim()
    setRecap(recapText || "*No summary generated.*")
    promptCounters.set(sessionID, 0)

  } catch (err: any) {
    setRecap(`*Error: ${err?.message ?? String(err)}*`)
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    if (recapSessionID) {
      await context.client.session.remove({ sessionID: recapSessionID }).catch(() => {})
    }
    setLoading(false)
  }
}

function View(props: { sessionID: string; onRecap: () => void }) {
  const context = usePlugin()
  const theme = () => context.theme
  const recap = () => getRecapSignal(props.sessionID)[0]()
  const loading = () => getLoadingSignal(props.sessionID)[0]()
  const syntaxStyle = createMemo(() => buildSyntaxStyle(context))

  return (
    <box>
      <text
        fg={theme().text.base}
        attributes={TextAttributes.BOLD}
        onMouseDown={() => { if (!loading()) props.onRecap() }}
      >
        {loading() ? "Generating..." : "Recap"}
      </text>
      <Show when={recap() !== null && !loading()}>
        <markdown
          content={recap()!}
          syntaxStyle={syntaxStyle()}
          fg={theme().text.muted}
        />
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.recap",
  setup(context) {
    let configuredRecapModel: ModelChoice | undefined
    let optionsError: string | undefined

    try {
      configuredRecapModel = readConfiguredModel(context.options as RecapOptions | undefined)
    } catch (err: any) {
      optionsError = err?.message ?? String(err)
    }

    // Track user prompts per session and clear stale recaps.
    // NOTE: the V1 event names `session.status` / `session.idle` still exist in the V2 type
    // union but are NOT emitted by the 2.2.6 server (verified live: zero deliveries across
    // multiple prompts). `session.execution.started` fires exactly once per prompt when its
    // execution begins — the closest live equivalent of V1's busy status.
    const stopEvents = context.data.on("session.execution.started", (event) => {
      const sessionID = event.data.sessionID
      if (!sessionID) return
      const [recap] = getRecapSignal(sessionID)
      if (recap() === null) return

      const count = (promptCounters.get(sessionID) ?? 0) + 1
      promptCounters.set(sessionID, count)
      if (count >= PROMPTS_UNTIL_STALE) {
        const [, setRecap] = getRecapSignal(sessionID)
        setRecap(null)
        promptCounters.set(sessionID, 0)
      }
    })

    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: (input) => (
        <View
          sessionID={input.sessionID}
          onRecap={() => void generateRecap(context, input.sessionID, {
            configuredModel: configuredRecapModel,
            optionsError,
          })}
        />
      ),
    })

    return () => {
      stopEvents()
      stopSlot()
    }
  },
})
