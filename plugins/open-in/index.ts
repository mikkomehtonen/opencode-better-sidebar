/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { platform } from "node:os"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { existsSync } from "node:fs"

// V2 API facts verified against @opencode/plugin@2.2.6 shipped .d.ts (2026-11-07):
// - Plugin.define({ id, setup(ctx) }) from "@opencode/plugin/tui"; usePlugin() returns the
//   same Context inside slot JSX (type is `ReturnType<typeof usePlugin>` / `Context` from
//   "@opencode/plugin/tui/context").
// - ui.slot({ append: "sidebar.content", render: ({ sessionID }) => ... }) returns an
//   unregister fn; no numeric order — stacking follows registration order.
// - Toasts: context.ui.toast.show({ variant: "error", message }) — ToastOptions is
//   { title?, message, variant?: "info" | "success" | "warning" | "error", duration?, sessionID? }.
// - Session directory: data.session.get(id)?.location.directory (AbsolutePath) plus
//   ?.subpath (RelativePath); context.location / data.location.default() are LocationRefs
//   with .directory. The data store is reactive and already populated for rendered sessions.
// - context.theme tokens (RGBA, pass to `fg`): text.base, text.muted.
// - onMouseDown remains a Renderable event prop in OpenTUI 0.8.3.

type IDEAction = {
  label: string
  appName: string
  command?: string
}

type IDEAvailability = "unknown" | "checking" | "available" | "missing"

const IDES: IDEAction[] = [
  { label: "Zed", appName: "Zed", command: "zed" },
  { label: "VS Code", appName: "Visual Studio Code" },
  { label: "Cursor", appName: "Cursor" },
]

const busyBySession = new Map<string, ReturnType<typeof createSignal<boolean>>>()
const availabilityByIDE = new Map<string, ReturnType<typeof createSignal<IDEAvailability>>>()

function getBusySignal(sessionID: string) {
  if (!busyBySession.has(sessionID)) busyBySession.set(sessionID, createSignal(false))
  return busyBySession.get(sessionID)!
}

function getAvailabilitySignal(appName: string) {
  if (!availabilityByIDE.has(appName)) {
    availabilityByIDE.set(appName, createSignal<IDEAvailability>("unknown"))
  }
  return availabilityByIDE.get(appName)!
}

function resolveZedCLIPath(): string | undefined {
  const which = spawnSync("which", ["zed"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  const fromPath = which.status === 0 ? which.stdout.trim() : ""
  const candidates = [
    fromPath,
    "/opt/homebrew/bin/zed",
    "/usr/local/bin/zed",
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

function checkIDEInstalled(ide: IDEAction): boolean {
  if (ide.command === "zed") {
    return Boolean(resolveZedCLIPath())
  }

  const result = spawnSync("open", ["-Ra", ide.appName], { stdio: "ignore" })
  return result.status === 0
}

function refreshIDEAvailability() {
  if (platform() !== "darwin") {
    for (const ide of IDES) {
      const [, setAvailability] = getAvailabilitySignal(ide.appName)
      setAvailability("missing")
    }
    return
  }

  for (const ide of IDES) {
    const [, setAvailability] = getAvailabilitySignal(ide.appName)
    setAvailability("checking")
  }

  for (const ide of IDES) {
    const [, setAvailability] = getAvailabilitySignal(ide.appName)
    setAvailability(checkIDEInstalled(ide) ? "available" : "missing")
  }
}

function resolveSessionDirectory(
  context: ReturnType<typeof usePlugin>,
  sessionID: string,
): string | undefined {
  const info = context.data.session.get(sessionID)
  const sessionDirectory = info?.location?.directory?.trim()
  const subpath = info?.subpath?.trim()
  if (sessionDirectory) {
    return subpath ? resolve(sessionDirectory, subpath) : sessionDirectory
  }

  return (
    context.location?.directory?.trim() ||
    context.data.location.default()?.directory?.trim() ||
    undefined
  )
}

function openInIDE(
  context: ReturnType<typeof usePlugin>,
  sessionID: string,
  ide: IDEAction,
) {
  const [busy, setBusy] = getBusySignal(sessionID)
  if (busy()) return

  setBusy(true)

  try {
    if (platform() !== "darwin") {
      throw new Error("Open In currently supports macOS only")
    }

    const [availability, setAvailability] = getAvailabilitySignal(ide.appName)
    if (availability() !== "available") {
      const installed = checkIDEInstalled(ide)
      setAvailability(installed ? "available" : "missing")
      if (!installed) {
        return
      }
    }

    const targetPath = resolveSessionDirectory(context, sessionID)

    if (!targetPath) {
      throw new Error("Could not resolve session directory")
    }

    const launchResult = ide.command === "zed"
      ? (() => {
          const zed = resolveZedCLIPath()
          if (!zed) throw new Error("Zed CLI not found")
          return spawnSync(zed, [targetPath], { stdio: "ignore" })
        })()
      : spawnSync("open", ["-a", ide.appName, targetPath], { stdio: "ignore" })

    if (launchResult.error) {
      throw launchResult.error
    }
    if ((launchResult.status ?? 1) !== 0) {
      throw new Error(`Failed to open in ${ide.label}`)
    }
  } catch (err: any) {
    const text = err?.message ?? String(err)
    context.ui.toast.show({
      variant: "error",
      message: `Open In: ${text}`,
    })
  } finally {
    setBusy(false)
  }
}

function IDEButton(props: {
  sessionID: string
  ide: IDEAction
}) {
  const context = usePlugin()
  const [busy] = getBusySignal(props.sessionID)
  const theme = () => context.theme
  const disabled = () => busy()

  return (
    <text
      fg={disabled() ? theme().text.muted : theme().text.base}
      attributes={TextAttributes.BOLD}
      onMouseDown={() => {
        if (!disabled()) {
          openInIDE(context, props.sessionID, props.ide)
        }
      }}
    >
      [{props.ide.label}]
    </text>
  )
}

function View(props: {
  sessionID: string
}) {
  const context = usePlugin()
  const installedIDEs = () => IDES.filter((ide) => getAvailabilitySignal(ide.appName)[0]() === "available")
  const theme = () => context.theme

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>Open In</text>
      <box flexDirection="row" gap={1}>
        <For each={installedIDEs()}>{(ide) => (
          <IDEButton sessionID={props.sessionID} ide={ide} />
        )}</For>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "streetturtle.open-in",
  setup(context) {
    refreshIDEAvailability()

    const stopSlot = context.ui.slot({
      append: "sidebar.content",
      render: (input) => <View sessionID={input.sessionID} />,
    })

    return () => stopSlot()
  },
})
