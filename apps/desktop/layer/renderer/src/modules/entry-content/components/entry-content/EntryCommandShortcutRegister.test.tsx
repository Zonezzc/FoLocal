import { FeedViewType } from "@follow/constants"
import { act } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { COMMAND_ID } from "~/modules/command/commands/id"
import {
  defaultCommandShortcuts,
  useSetCustomCommandShortcut,
} from "~/modules/command/hooks/use-command-binding"

import { EntryCommandShortcutRegister } from "./EntryCommandShortcutRegister"

const state = vi.hoisted(() => ({
  desktop: true,
  modal: false,
  focused: true,
  url: "https://example.org/article",
  run: vi.fn(),
}))
vi.mock("@follow/shared/constants", async (original) => ({
  ...(await original<typeof import("@follow/shared/constants")>()),
  get IN_ELECTRON() {
    return state.desktop
  },
}))
vi.mock("@follow/components/common/Focusable/hooks.js", () => ({
  useGlobalFocusableScopeSelector: () => state.focused,
}))
vi.mock("@follow/store/entry/hooks", () => ({ useEntry: () => ({ url: state.url }) }))
vi.mock("~/components/common/Focusable", () => ({
  FocusablePresets: { isEntryRender: () => true },
}))
vi.mock("~/components/ui/modal/stacked/hooks", () => ({ useHasModal: () => state.modal }))
vi.mock("~/hooks/biz/useNavigateEntry", () => ({ useNavigateEntry: () => vi.fn() }))
vi.mock("~/modules/command/hooks/use-command", () => ({
  getCommand: (id: string) =>
    id === "integration:save-to-siyuan" ? { run: state.run } : undefined,
}))

let root: Root
let host: HTMLDivElement
let resetShortcut: (() => void) | undefined
function Harness() {
  const customize = useSetCustomCommandShortcut()
  resetShortcut = () => customize(COMMAND_ID.integration.saveToSiyuan, null)
  return (
    <>
      <EntryCommandShortcutRegister entryId="article-a" view={FeedViewType.Articles} />
      <button onClick={() => customize(COMMAND_ID.integration.saveToSiyuan, "Control+Alt+X")}>
        Customize
      </button>
      <input aria-label="Article title" />
    </>
  )
}
const pressDefault = (target: Element = document.documentElement) => {
  const shortcut = defaultCommandShortcuts[COMMAND_ID.integration.saveToSiyuan]
  const key = shortcut.split("+").at(-1)!.toLowerCase()
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: `Key${key.toUpperCase()}`,
      shiftKey: true,
      metaKey: shortcut.includes("Meta"),
      ctrlKey: shortcut.includes("Control"),
      bubbles: true,
      cancelable: true,
    }),
  )
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  Object.assign(state, {
    desktop: true,
    modal: false,
    focused: true,
    url: "https://example.org/article",
  })
  state.run.mockReset()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => {
    resetShortcut?.()
  })
  await act(async () => {
    root.unmount()
  })
  host.remove()
  resetShortcut = undefined
  vi.unstubAllGlobals()
})
describe("SiYuan clipping shortcut", () => {
  it("opens clipping for the current article exactly once", async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    pressDefault()
    expect(state.run).toHaveBeenCalledExactlyOnceWith({ entryId: "article-a" })
  })
  it("does not intercept shortcuts while editing text", async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    pressDefault(host.querySelector("input")!)
    expect(state.run).not.toHaveBeenCalled()
  })
  it.each([
    ["an open modal", { modal: true }],
    ["another focus scope", { focused: false }],
    ["a missing source URL", { url: "" }],
    ["the web app", { desktop: false }],
  ])("does not trigger with %s", async (_name, values) => {
    Object.assign(state, values)
    await act(async () => {
      root.render(<Harness />)
    })
    pressDefault()
    expect(state.run).not.toHaveBeenCalled()
  })
  it("uses a customized shortcut and stops responding to the default", async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    await act(async () => {
      host.querySelector("button")!.click()
    })
    pressDefault()
    expect(state.run).not.toHaveBeenCalled()
    document.documentElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "x",
        code: "KeyX",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      }),
    )
    expect(state.run).toHaveBeenCalledExactlyOnceWith({ entryId: "article-a" })
  })
})
