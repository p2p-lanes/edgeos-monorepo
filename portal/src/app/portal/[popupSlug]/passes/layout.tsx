"use client"
import type { ReactNode } from "react"
import { GroupsProvider } from "@/providers/groupsProvider"

const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <GroupsProvider>
      <div className="py-6">{children}</div>
    </GroupsProvider>
  )
}
export default Layout
