import { describeNetworkError } from "./network.js"

export type FeedErrorKind = "offline" | "transient" | "permanent" | "parse" | "unknown"

export class FeedFetchError extends Error {
  constructor(
    public readonly kind: FeedErrorKind,
    message: string,
  ) {
    super(message)
    this.name = "FeedFetchError"
  }
}

export const classifyFeedError = (error: unknown): FeedErrorKind => {
  if (error instanceof FeedFetchError) return error.kind
  const message = describeNetworkError(error)
  if (/ERR_INTERNET_DISCONNECTED|\bENETDOWN\b/.test(message)) return "offline"
  if (/timed? ?out|ETIMEDOUT|ENOTFOUND|ECONN|net::ERR_/i.test(message)) return "transient"
  return "unknown"
}
