"use client"

import { useRef } from "react"

interface InitialQueryResolutionState {
  isPending: boolean
  isFetching: boolean
  isFetchedAfterMount: boolean
}

export function useInitialQueryResolution(
  key: string,
  state: InitialQueryResolutionState,
): boolean {
  const pending = isInitialQueryResolutionPending(state)
  const resolution = useRef({ key, isSettled: !pending })

  if (resolution.current.key !== key) {
    resolution.current = { key, isSettled: !pending }
  } else if (!pending) {
    resolution.current.isSettled = true
  }

  return !resolution.current.isSettled
}

export function isInitialQueryResolutionPending({
  isPending,
  isFetching,
  isFetchedAfterMount,
}: InitialQueryResolutionState): boolean {
  return isPending || (isFetching && !isFetchedAfterMount)
}
