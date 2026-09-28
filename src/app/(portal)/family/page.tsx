"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading, formatWhen } from "@/components/state"

type Note = { id: string; note: string; confirmedAt: string }
type Payload = {
  canWrite: boolean
  notes: Note[]
  plans: { done: number; total: number }
  submission: { receipt: string } | null
  outcomes: { confirmed: number; total: number }
}

export default function FamilyPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [note, setNote] = useState("Tối thứ Năm tôi ngồi cùng con xem lại ví dụ điểm số.")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function load() {
    const response = await fetch("/api/family")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error)
    setData(body)
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const response = await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error)
      return
    }
    setNotice("Đã ghi nhận thời gian đồng hành.")
    await load()
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Đồng hành cùng Lê An</h1>
        <p className="mt-1 text-muted-foreground">
          Việc đã xong {data.plans.done}/{data.plans.total}. Mục tiêu đã xác nhận {data.outcomes.confirmed}/{data.outcomes.total}.{" "}
          {data.submission ? `Bài thực hành có biên nhận ${data.submission.receipt}.` : "Chưa có bài thực hành."}
        </p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
      {data.canWrite ? (
        <form className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10" onSubmit={save}>
          <Label htmlFor="note">Cách tôi sẽ đồng hành tuần này</Label>
          <Textarea id="note" value={note} onChange={(event) => setNote(event.target.value)} />
          <Button type="submit">Xác nhận sẽ dành thời gian</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Bạn xem ghi nhận của gia đình, không ghi thay phụ huynh.</p>
      )}
      <ul className="space-y-2 text-sm">
        {data.notes.map((item) => (
          <li key={item.id} className="rounded-lg bg-muted px-3 py-2">
            {item.note}
            <span className="block text-muted-foreground">{formatWhen(item.confirmedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
