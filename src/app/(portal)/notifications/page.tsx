"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { EmptyNote, ErrorNote, Loading, formatWhen } from "@/components/state"

type Item = { id: string; title: string; summary: string; href: string; createdAt: string; readAt: string | null }

export default function NotificationsPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState("")

  async function load() {
    const response = await fetch("/api/notifications")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không tải được thông báo.")
    setItems(body.items)
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function mark(id?: string) {
    setError("")
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error || "Chưa đánh dấu được.")
      return
    }
    setItems(body.items)
  }

  if (error && !items) return <ErrorNote message={error} />
  if (!items) return <Loading label="Đang tải thông báo..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Thông báo</h1>
          <p className="mt-2 text-[#5b6476]">Chỉ hiện việc của tài khoản này. Nội dung bài làm không nằm trong thông báo.</p>
        </div>
        {items.some((item) => !item.readAt) ? (
          <Button type="button" variant="outline" onClick={() => mark()}>
            Đánh dấu đã đọc
          </Button>
        ) : null}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {items.length === 0 ? (
        <EmptyNote>Chưa có thông báo.</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="surface p-4 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm text-[#5b6476]">{formatWhen(item.createdAt)}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-sm ${item.readAt ? "bg-[#f6f7fb] text-[#5b6476]" : "bg-[#eff6ff] text-[#1e40af]"}`}>
                  {item.readAt ? "Đã đọc" : "Chưa đọc"}
                </span>
              </div>
              <p className="mt-3 text-[#22263b]">{item.summary}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="inline-flex min-h-11 items-center text-sm font-medium text-[#5150df]" href={item.href} onClick={() => mark(item.id)}>
                  Mở nội dung
                </Link>
                {!item.readAt ? (
                  <button type="button" className="min-h-11 text-sm text-[#5b6476]" onClick={() => mark(item.id)}>
                    Đánh dấu đã đọc
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
