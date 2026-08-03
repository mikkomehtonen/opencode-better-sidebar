/** @jsxImportSource @opentui/solid */
import { createSignal, For } from "solid-js"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { platform } from "node:os"
import { spawnSync } from "node:child_process"
import { isAbsolute, resolve } from "node:path"
import { existsSync } from "node:fs"

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

async function openInIDE(api: TuiPluginApi, sessionID: string, ide: IDEAction) {
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

    const stateDirectory = api.state.path.directory?.trim()
    const session = await api.client.session.get({ sessionID })
    const info = session.data
    const rawPath = info?.path?.trim()
    const sessionDirectory = info?.directory?.trim()

    const targetPath = stateDirectory
      ?? (rawPath
        ? (isAbsolute(rawPath) ? rawPath : resolve(sessionDirectory ?? ".", rawPath))
        : sessionDirectory)

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
    api.ui.toast({
      variant: "error",
      message: `Open In: ${text}`,
    })
  } finally {
    setBusy(false)
  }
}

function IDEButton(props: {
  api: TuiPluginApi
  sessionID: string
  ide: IDEAction
}) {
  const [busy] = getBusySignal(props.sessionID)
  const theme = () => props.api.theme.current
  const disabled = () => busy()

  return (
    <text
      fg={disabled() ? theme().textMuted : theme().text}
      attributes={TextAttributes.BOLD}
      onMouseDown={() => {
        if (!disabled()) {
          void openInIDE(props.api, props.sessionID, props.ide)
        }
      }}
    >
      [{props.ide.label}]
    </text>
  )
}

function View(props: {
  api: TuiPluginApi
  sessionID: string
}) {
  const installedIDEs = () => IDES.filter((ide) => getAvailabilitySignal(ide.appName)[0]() === "available")
  const theme = () => props.api.theme.current

  return (
    <box>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>Open In</text>
      <box flexDirection="row" gap={1}>
        <For each={installedIDEs()}>{(ide) => (
          <IDEButton api={props.api} sessionID={props.sessionID} ide={ide} />
        )}</For>
      </box>
    </box>
  )
}

const main: TuiPlugin = async (api) => {
  const { slots } = api

  refreshIDEAvailability()

  slots.register({
    order: 290,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

export default { id: "streetturtle.open-in", tui: main }
