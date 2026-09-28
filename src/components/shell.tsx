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
    { href: "/learn", label: "Khóa học", icon: BookOpen },
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
  ],
  teacher: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/teaching", label: "Lớp giảng dạy", icon: Users },
    { href: "/assessment", label: "Chờ phản hồi", icon: ClipboardCheck },
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
  ],
  guardian: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/plans", label: "Kế hoạch", icon: CalendarCheck },
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
    { href: "/family", label: "Kế hoạch hỗ trợ", icon: Heart },
  ],
}

const secondary: Record<SessionUser["role"], { href: string; label: string; icon: typeof Compass }[]> = {
  student: [
    { href: "/assessment", label: "Tự kiểm tra", icon: ClipboardCheck },
    { href: "/about", label: "Mô hình học", icon: Compass },
  ],
  teacher: [{ href: "/about", label: "Mô hình học", icon: Compass }],
  guardian: [{ href: "/about", label: "Mô hình học", icon: Compass }],
}

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const items = nav[user.role]
  const extra = secondary[user.role]

  async function logout() {
    await fetch("/api/session", { method: "DELETE" })
    router.push("/login")
    router.refresh()
  }

  function itemClass(active: boolean) {
    return `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${active ? "bg-[#eeedff] text-[#5150df]" : "text-[#5b6476] hover:bg-[#f6f7fb]"}`
  }

  return (
    <div className="min-h-full bg-[#f6f7fb] md:grid md:grid-cols-[216px_1fr] xl:grid-cols-[248px_1fr]">
      <a className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[10px] focus:bg-white focus:px-3 focus:py-2" href="#noi-dung">
        Bỏ qua điều hướng
      </a>
      <aside className="border-[#d9ddea] bg-white text-[#22263b] md:min-h-screen md:border-r">
        <div className="flex min-h-14 items-center justify-between px-4 xl:min-h-[72px]">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[#5150df] text-sm font-semibold text-white">HC</span>
            <span>
              <span className="block text-[13px] text-[#5b6476]">LMS</span>
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
                  <Link href={item.href} onClick={() => setOpen(false)} className={itemClass(active)} aria-current={active ? "page" : undefined}>
                    <Icon className="size-5" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
          <p className="mt-6 px-3 text-[13px] text-[#5b6476]">Thêm</p>
          <ul className="mt-1 space-y-1">
            {extra.map((item) => {
              const active = pathname === item.href
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className={itemClass(active)} aria-current={active ? "page" : undefined}>
                    <Icon className="size-5" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="m-3 mt-6 rounded-2xl border border-[#d9ddea] bg-white p-3">
          <p className="text-sm font-medium text-[#22263b]">{user.name}</p>
          <p className="text-[13px] text-[#5b6476]">{labels[user.role]} · Tin học 10</p>
          <button type="button" className="mt-3 min-h-11 text-sm font-medium text-[#5150df] hover:text-[#4342c4]" onClick={logout}>
            Thoát phiên
          </button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[#d9ddea] bg-white px-4 md:min-h-16 md:px-6 xl:min-h-[72px] xl:px-8">
          <div>
            <p className="text-[13px] font-medium text-[#5150df]">Lớp học phần</p>
            <p className="font-medium text-[#22263b]">Tin học 10 · Lớp 10A1 · Tuần 28/09 – 04/10/2026</p>
          </div>
          <p className="text-sm text-[#5b6476]">
            {user.role === "student" ? "Lê An đang học" : user.role === "teacher" ? "Nguyễn Hà phụ trách" : "Đang xem hồ sơ của Lê An"}
          </p>
        </header>
        <main id="noi-dung" className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
