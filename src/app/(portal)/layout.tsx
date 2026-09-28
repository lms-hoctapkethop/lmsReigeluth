import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { Shell } from "@/components/shell"
import { getSessionUser } from "@/lib/session"

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  return <Shell user={user}>{children}</Shell>
}
