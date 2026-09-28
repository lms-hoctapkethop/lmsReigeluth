"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { SessionUser } from "@/lib/session"

const labels: Record<SessionUser["role"], string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  guardian: "Phụ huynh",
}

const nav: Record<SessionUser["role"], { href: string; label: string }[]> = {
  student: [
    { href: "/dashboard", label: "Tổng quan" },
    { href: "/plans", label: "Kế hoạch" },
    { href: "/learn", label: "Học tập" },
    { href: "/records", label: "Hồ sơ" },
    { href: "/assessment", label: "Đánh giá" },
    { href: "/about", label: "Mô hình" },
  ],
  teacher: [
    { href: "/dashboard", label: "Tổng quan" },
    { href: "/teaching", label: "Lớp học" },
    { href: "/assessment", label: "Hàng chờ" },
    { href: "/records", label: "Hồ sơ lớp" },
    { href: "/about", label: "Mô hình" },
  ],
  guardian: [
    { href: "/dashboard", label: "Tổng quan" },
    { href: "/plans", label: "Kế hoạch của con" },
    { href: "/records", label: "Hồ sơ của con" },
    { href: "/family", label: "Đồng hành" },
    { href: "/about", label: "Mô hình" },
  ],
}

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const items = nav[user.role]

  async function logout() {
    await fetch("/api/session", { method: "DELETE" })
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="min-h-full md:grid md:grid-cols-[245px_1fr]">
      <aside className="border-b bg-sidebar md:min-h-screen md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="block">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">LMS</p>
            <p className="text-lg font-semibold text-foreground">Học cùng nhau</p>
          </Link>
          <Button className="md:hidden" variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "Đóng" : "Mục"}
          </Button>
        </div>
        <nav className={`${open ? "block" : "hidden"} px-3 pb-4 md:block`} aria-label="Điều hướng chính">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring ${active ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted"}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 md:px-8">
          <div>
            <p className="text-sm text-muted-foreground">Tin học 10 · Lớp 10A1 · Tuần 28/09 – 04/10/2026</p>
            <p className="font-medium">
              {user.role === "student" ? "Lê An đang học" : user.role === "teacher" ? "Nguyễn Hà phụ trách lớp học phần" : "Trần Mai đang xem hồ sơ của Lê An"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm">
              <span className="font-medium">{user.name}</span>
              <span className="text-muted-foreground"> · {labels[user.role]}</span>
            </p>
            <Button variant="outline" size="sm" onClick={logout}>
              Thoát
            </Button>
          </div>
        </header>
        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  )
}
