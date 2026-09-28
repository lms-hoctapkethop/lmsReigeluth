"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import {
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Compass,
  FolderOpen,
  Heart,
  LayoutDashboard,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SessionUser } from "@/lib/session"

const labels: Record<SessionUser["role"], string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  guardian: "Phụ huynh",
}

const nav: Record<SessionUser["role"], { href: string; label: string; icon: typeof LayoutDashboard }[]> = {
  student: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/plans", label: "Kế hoạch", icon: CalendarCheck },
    { href: "/learn", label: "Học tập", icon: BookOpen },
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
    { href: "/assessment", label: "Đánh giá", icon: ClipboardCheck },
    { href: "/about", label: "Mô hình", icon: Compass },
  ],
  teacher: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/teaching", label: "Lớp học", icon: Users },
    { href: "/assessment", label: "Hàng chờ", icon: ClipboardCheck },
    { href: "/records", label: "Hồ sơ lớp", icon: FolderOpen },
    { href: "/about", label: "Mô hình", icon: Compass },
  ],
  guardian: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/plans", label: "Kế hoạch của con", icon: CalendarCheck },
    { href: "/records", label: "Hồ sơ của con", icon: FolderOpen },
    { href: "/family", label: "Đồng hành", icon: Heart },
    { href: "/about", label: "Mô hình", icon: Compass },
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
    <div className="min-h-full bg-[#f5f6fa] md:grid md:grid-cols-[245px_1fr]">
      <aside className="border-[#e6e4f2] bg-[#f3f2f8] text-[#22263b] md:min-h-screen md:border-r">
        <div className="flex items-center justify-between px-4 py-5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[#5150df] text-sm font-semibold text-white">HC</span>
            <span>
              <span className="block text-[11px] tracking-[0.14em] text-[#8b90a5] uppercase">LMS</span>
              <span className="block text-base font-semibold text-[#22263b]">Học cùng nhau</span>
            </span>
          </Link>
          <Button className="md:hidden" variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? "Đóng" : "Mục"}
          </Button>
        </div>
        <nav className={`${open ? "block" : "hidden"} px-3 md:block`} aria-label="Điều hướng chính">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = pathname === item.href
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium focus-visible:ring-3 focus-visible:ring-[#8d86ff] ${active ? "bg-white text-[#5150df] shadow-[0_1px_2px_rgba(34,38,59,0.06)]" : "text-[#5c657c] hover:bg-white/80"}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="m-3 mt-6 rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(34,38,59,0.04)]">
          <p className="text-sm font-medium text-[#22263b]">{user.name}</p>
          <p className="text-xs text-[#69718a]">{labels[user.role]} · Tin học 10</p>
          <button type="button" className="mt-3 text-xs font-medium text-[#5150df] hover:text-[#3a34b0]" onClick={logout}>
            Thoát phiên
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e4f2] bg-white/80 px-4 py-3 backdrop-blur md:px-8">
          <div>
            <p className="text-xs font-medium tracking-wide text-[#5150df] uppercase">Lớp học phần</p>
            <p className="font-medium text-[#22263b]">Tin học 10 · Lớp 10A1 · Tuần 28/09 – 04/10/2026</p>
          </div>
          <p className="text-sm text-[#69718a]">
            {user.role === "student" ? "Lê An đang học" : user.role === "teacher" ? "Nguyễn Hà phụ trách" : "Đang xem hồ sơ của Lê An"}
          </p>
        </header>
        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  )
}
