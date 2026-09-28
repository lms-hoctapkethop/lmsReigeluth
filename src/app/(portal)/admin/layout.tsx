import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/session"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  if (user.role !== "admin") redirect("/dashboard")
  return children
}
