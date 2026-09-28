"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Bell,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Compass,
  FolderOpen,
  Heart,
  LayoutDashboard,
  Library,
  ScrollText,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SessionUser } from "@/lib/session"

const labels: Record<SessionUser["role"], string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  guardian: "Phụ huynh",
  admin: "Quản trị",
}

const nav: Record<SessionUser["role"], { href: string; label: string; icon: typeof LayoutDashboard }[]> = {
  student: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/plans", label: "Kế hoạch", icon: CalendarCheck },
    { href: "/learn", label: "Khóa học", icon: BookOpen },
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
    { href: "/notifications", label: "Thông báo", icon: Bell },
  ],
  teacher: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/teaching", label: "Lớp giảng dạy", icon: Users },
    { href: "/teaching/content", label: "Nội dung", icon: Library },
    { href: "/assessment", label: "Chờ phản hồi", icon: ClipboardCheck },
    { href: "/notifications", label: "Thông báo", icon: Bell },
  ],
  guardian: [
    { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
    { href: "/plans", label: "Kế hoạch", icon: CalendarCheck },
    { href: "/family", label: "Kế hoạch hỗ trợ", icon: Heart },
    { href: "/notifications", label: "Thông báo", icon: Bell },
  ],
  admin: [
    { href: "/admin/users", label: "Tài khoản", icon: Users },
    { href: "/admin/organization", label: "Tổ chức học", icon: BookOpen },
    { href: "/admin/links", label: "Liên kết gia đình", icon: Heart },
    { href: "/admin/audit", label: "Nhật ký", icon: ScrollText },
    { href: "/notifications", label: "Thông báo", icon: Bell },
  ],
}

const secondary: Record<SessionUser["role"], { href: string; label: string; icon: typeof Compass }[]> = {
  student: [
    { href: "/assessment", label: "Tự kiểm tra", icon: ClipboardCheck },
    { href: "/about", label: "Mô hình học", icon: Compass },
  ],
  teacher: [
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
    { href: "/about", label: "Mô hình học", icon: Compass },
  ],
  guardian: [
    { href: "/records", label: "Hồ sơ", icon: FolderOpen },
    { href: "/about", label: "Mô hình học", icon: Compass },
  ],
  admin: [{ href: "/about", label: "Mô hình học", icon: Compass }],
}

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [heading, setHeading] = useState("Tin học 10 · Lớp 10A1 · Tuần 28/09 – 04/10/2026")
  const [unread, setUnread] = useState(0)
  const items = nav[user.role]
  const extra = secondary[user.role]

  useEffect(() => {
    fetch("/api/context")
      .then(async (response) => {
        if (!response.ok) return
        const body = (await response.json()) as { org?: { offeringTitle: string; weekLabel: string }; unread?: number }
        if (body.org) setHeading(`${body.org.offeringTitle} · Tuần ${body.org.weekLabel}`)
        setUnread(body.unread ?? 0)
      })
      .catch(() => undefined)
  }, [pathname])

  async function logout() {
    await fetch("/api/session", { method: "DELETE" })
    router.push("/login")
    router.refresh()
  }

  function isActive(href: string) {
    if (href === "/teaching") return pathname === "/teaching"
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  function itemClass(active: boolean) {
    return `flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${active ? "bg-[#eeedff] text-[#5150df]" : "text-[#5b6476] hover:bg-[#f6f7fb]"}`
  }

  return (
    <div className="min-h-full bg-[#f6f7fb] md:grid md:grid-cols-[216px_1fr] xl:grid-cols-[248px_1fr]">
      <a className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[10px] focus:bg-white focus:px-3 focus:py-2" href="#noi-dung">
        Bỏ qua điều hướng
      </a>
      <aside className="border-[#d9ddea] bg-white text-[#22263b] md:min-h-screen md:overflow-y-auto md:border-r">
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
              const active = isActive(item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className={itemClass(active)} aria-current={active ? "page" : undefined}>
                    <Icon className="size-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/notifications" && unread > 0 ? (
                      <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#1e40af]">{unread} chưa đọc</span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
          <p className="mt-6 px-3 text-[13px] text-[#5b6476]">Thêm</p>
          <ul className="mt-1 space-y-1">
            {extra.map((item) => {
              const active = isActive(item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className={itemClass(active)} aria-current={active ? "page" : undefined}>
                    <Icon className="size-5" />
                    <span className="flex-1">{item.label}</span>
                    {item.href === "/notifications" && unread > 0 ? (
                      <span className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-xs font-medium text-[#1e40af]">{unread} chưa đọc</span>
                    ) : null}
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
            <p className="font-medium text-[#22263b]">{heading}</p>
          </div>
          <p className="text-sm text-[#5b6476]">
            {user.role === "student" ? "Lê An đang học" : user.role === "teacher" ? "Nguyễn Hà phụ trách" : user.role === "admin" ? "Quản trị nhà trường" : "Đang xem hồ sơ của Lê An"}
          </p>
        </header>
        <main id="noi-dung" className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-8 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
