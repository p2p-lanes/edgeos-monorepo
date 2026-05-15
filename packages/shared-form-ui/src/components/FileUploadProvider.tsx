"use client"

import { createContext, type ReactNode, useContext } from "react"

export interface SharedUploadResult {
  publicUrl: string
  key: string
}

export type SharedUploadFn = (file: File) => Promise<SharedUploadResult>

const FileUploadContext = createContext<SharedUploadFn | null>(null)

export interface FileUploadProviderProps {
  value: SharedUploadFn
  children: ReactNode
}

export function FileUploadProvider({
  value,
  children,
}: FileUploadProviderProps) {
  return (
    <FileUploadContext.Provider value={value}>
      {children}
    </FileUploadContext.Provider>
  )
}

/**
 * Returns the upload function injected by the host app, or null when no
 * provider is present (form-builder preview, storybook). Consumers should
 * gracefully disable upload UI when this is null.
 */
export function useFileUploadFn(): SharedUploadFn | null {
  return useContext(FileUploadContext)
}
