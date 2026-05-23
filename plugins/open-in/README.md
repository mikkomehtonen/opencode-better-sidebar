# @streetturtle/opencode-open-in

OpenCode sidebar plugin with one-click IDE launch buttons for the current session.

## What it does

- Adds an **Open In** section to the sidebar
- Shows buttons for installed IDEs only (Zed, VS Code, Cursor)
- Opens the active session directory directly in your IDE

## Install

```sh
opencode plugin @streetturtle/opencode-open-in
```

Global install:

```sh
opencode plugin --global @streetturtle/opencode-open-in
```

## Usage

Open any session and click the IDE button in the sidebar.

## Notes

- macOS only (`open -a`)
- If a button is missing, the IDE was not detected as installed
