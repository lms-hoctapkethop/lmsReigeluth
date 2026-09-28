"use client"

import { useEffect, useState } from "react"
import { EmptyNote, ErrorNote, Loading, formatWhen } from "@/components/state"

type EventRow = { id: string; at: string; actorName: string; action: string; target: string }

export default function AuditPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin/audit")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được nhật ký.")
        setEvents(body.events)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!events) return <Loading label="Đang tải nhật ký..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Nhật ký</h1>
        <p className="mt-2 text-[#5b6476]">90 ngày gần nhất. Không gồm nội dung bài làm hay mật khẩu.</p>
      </div>
      {events.length === 0 ? (
        <EmptyNote>Chưa có sự kiện nào được ghi.</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="surface p-4">
              <p className="font-medium">{event.action}</p>
              <p className="mt-1 text-sm text-[#5b6476]">{formatWhen(event.at)} · {event.actorName}</p>
              <p className="mt-2 text-sm">{event.target}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
