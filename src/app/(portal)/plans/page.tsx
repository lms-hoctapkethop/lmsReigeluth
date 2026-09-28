"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyNote, ErrorNote, Loading } from "@/components/state"

type Plan = { id: string; title: string; due: string; source: "assigned" | "personal"; done: boolean }
type Payload = { plans: Plan[]; canEdit: boolean; course: { week: string } }

export default function PlansPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const [title, setTitle] = useState("")
  const [due, setDue] = useState("2026-10-02")
  const [notice, setNotice] = useState("")
  const [open, setOpen] = useState(false)

  async function load() {
    const response = await fetch("/api/plans")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không tải được kế hoạch.")
    setData(body)
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function toggle(id: string) {
    setNotice("")
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error)
      return
    }
    setData((current) => (current ? { ...current, plans: body.plans } : current))
  }

  async function addPlan(event: React.FormEvent) {
    event.preventDefault()
    setNotice("")
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error)
      return
    }
    setData((current) => (current ? { ...current, plans: body.plans } : current))
    setTitle("")
    setOpen(false)
    setNotice("Đã thêm việc vào kế hoạch.")
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Kế hoạch học tập</h1>
          <p className="mt-1 text-muted-foreground">Tuần {data.course.week}. Việc được giao và việc Lê An tự thêm nằm cùng một danh sách.</p>
        </div>
        {data.canEdit ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button type="button">Thêm việc của tôi</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Việc cá nhân</DialogTitle>
                <DialogDescription>Chọn một ngày trong tuần 28/09 – 04/10/2026.</DialogDescription>
              </DialogHeader>
              <form className="space-y-3" onSubmit={addPlan}>
                <div className="space-y-2">
                  <Label htmlFor="title">Việc cần làm</Label>
                  <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="due">Ngày</Label>
                  <Input id="due" type="date" min="2026-09-28" max="2026-10-04" value={due} onChange={(event) => setDue(event.target.value)} required />
                </div>
                <DialogFooter>
                  <Button type="submit">Lưu vào kế hoạch</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <p className="text-sm text-muted-foreground">Bạn đang xem kế hoạch, không sửa thay học sinh.</p>
        )}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
      {data.plans.length === 0 ? <EmptyNote>Tuần này chưa có việc nào.</EmptyNote> : null}
      <ul className="space-y-3">
        {data.plans.map((plan) => (
          <li key={plan.id} className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Checkbox checked={plan.done} disabled={!data.canEdit} onCheckedChange={() => toggle(plan.id)} aria-label={plan.title} />
            <div>
              <p className={plan.done ? "font-medium line-through" : "font-medium"}>{plan.title}</p>
              <p className="text-sm text-muted-foreground">
                Hạn {plan.due.split("-").reverse().join("/")} · {plan.source === "assigned" ? "Được giao" : "Tự thêm"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
