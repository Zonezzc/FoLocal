import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, createElement, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { LocalRefreshStatus } from "~/queries/feed"

import { LocalRefreshSync } from "./use-local-refresh-sync"

const mocks = vi.hoisted(() => ({
  appLog: vi.fn(),
  invalidateAfterRefresh: vi.fn<(queryClient: QueryClient) => Promise<void>>(),
  useRefreshStatusQuery: vi.fn<() => { data: LocalRefreshStatus | undefined }>(),
}))

vi.mock("~/lib/log", () => ({ appLog: mocks.appLog }))
vi.mock("~/queries/feed", () => ({
  invalidateAfterRefresh: mocks.invalidateAfterRefresh,
  useRefreshStatusQuery: mocks.useRefreshStatusQuery,
}))

const createStatus = (finishedAt: string | null): LocalRefreshStatus => ({
  intervalMinutes: 30,
  lastRun: finishedAt
    ? {
        total: 1,
        failed: 0,
        notModified: 0,
        startedAt: "2026-09-12T00:00:00.000Z",
        finishedAt,
        running: false,
      }
    : null,
  running: false,
})

const firstCompletion = "2026-09-12T00:01:00.000Z"
const laterCompletion = "2026-09-12T00:31:00.000Z"
const latestCompletion = "2026-09-12T01:01:00.000Z"

describe("LocalRefreshSync", () => {
  let root: Root
  let container: HTMLElement
  let queryClient: QueryClient

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    mocks.appLog.mockClear()
    mocks.invalidateAfterRefresh.mockReset().mockResolvedValue(undefined)
    mocks.useRefreshStatusQuery.mockReset()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    queryClient = new QueryClient()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    vi.unstubAllGlobals()
  })

  const renderStatus = async (data: LocalRefreshStatus | undefined) => {
    mocks.useRefreshStatusQuery.mockReturnValue({ data })
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(LocalRefreshSync),
          ),
        ),
      )
    })
  }

  test.each([false, true])(
    "invalidates the first completion after no runs (initial loading: %s)",
    async (initialLoading) => {
      if (initialLoading) {
        await renderStatus(undefined)
        await renderStatus(undefined)
        expect(mocks.invalidateAfterRefresh).not.toHaveBeenCalled()
      }

      await renderStatus(createStatus(null))
      await renderStatus(createStatus(null))
      expect(mocks.invalidateAfterRefresh).not.toHaveBeenCalled()

      await renderStatus(createStatus(firstCompletion))
      expect(mocks.invalidateAfterRefresh).toHaveBeenCalledExactlyOnceWith(queryClient)

      await renderStatus(createStatus(firstCompletion))
      expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(1)
    },
  )

  test.each([false, true])(
    "baselines an initial historical completion (initial loading: %s)",
    async (initialLoading) => {
      if (initialLoading) {
        await renderStatus(undefined)
        await renderStatus(undefined)
      }

      await renderStatus(createStatus(firstCompletion))
      await renderStatus(createStatus(firstCompletion))
      expect(mocks.invalidateAfterRefresh).not.toHaveBeenCalled()
      expect(mocks.appLog).not.toHaveBeenCalled()
    },
  )

  test("ignores repeated timestamps and invalidates each later completion once", async () => {
    await renderStatus(createStatus(firstCompletion))
    await renderStatus({ ...createStatus(firstCompletion), running: true })
    expect(mocks.invalidateAfterRefresh).not.toHaveBeenCalled()

    await renderStatus(createStatus(laterCompletion))
    await renderStatus(createStatus(laterCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledExactlyOnceWith(queryClient)

    await renderStatus(createStatus(latestCompletion))
    await renderStatus(createStatus(latestCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(2)
    expect(mocks.invalidateAfterRefresh).toHaveBeenLastCalledWith(queryClient)
  })

  test("preserves the last valid observation while query data is undefined", async () => {
    await renderStatus(createStatus(null))
    await renderStatus(undefined)
    expect(mocks.invalidateAfterRefresh).not.toHaveBeenCalled()

    await renderStatus(createStatus(firstCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledExactlyOnceWith(queryClient)

    await renderStatus(undefined)
    await renderStatus(createStatus(firstCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(1)

    await renderStatus(undefined)
    await renderStatus(createStatus(laterCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(2)
  })

  test("logs rejected invalidation and continues handling later completions", async () => {
    const error = new Error("Invalidation failed")
    mocks.invalidateAfterRefresh.mockRejectedValueOnce(error)
    await renderStatus(createStatus(null))

    await renderStatus(createStatus(firstCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledExactlyOnceWith(queryClient)
    expect(mocks.appLog).toHaveBeenCalledWith("Background refresh invalidation failed", error)

    await renderStatus(createStatus(firstCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(1)

    await renderStatus(createStatus(laterCompletion))
    expect(mocks.invalidateAfterRefresh).toHaveBeenCalledTimes(2)
  })
})
