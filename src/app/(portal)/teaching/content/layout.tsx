import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/session"

export default async function ContentLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  if (user.role !== "teacher") redirect("/dashboard")
  return children
}
