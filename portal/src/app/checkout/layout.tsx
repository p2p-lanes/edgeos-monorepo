"use client"

import type { ReactNode } from "react"
import Providers from "./components/providers/Providers"

const layout = ({ children }: { children: ReactNode }) => {
  return <Providers>{children}</Providers>
}

export default layout
