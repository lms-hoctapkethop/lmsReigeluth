"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading } from "@/components/state"

type LinkState = { status: "pending" | "active" | "revoked"; reason: string; verifiedAt: string | null }

export default function LinksPage() {
  const [link, setLink] = useState<LinkState | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    fetch("/api/admin/links")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được liên kết.")
        setLink(body.link)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!link) return
    setPending(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/admin/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: link.status, reason: link.reason }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Chưa lưu được liên kết.")
      setLink(body.link)
      setNotice("Đã lưu liên kết. Phụ huynh chỉ xem hồ sơ khi trạng thái là đang hiệu lực.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  if (error && !link) return <ErrorNote message={error} />
  if (!link) return <Loading label="Đang tải liên kết gia đình..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Liên kết gia đình</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">Trần Mai xem hồ sơ của Lê An khi liên kết đang hiệu lực. Thu hồi không xóa bài đã học.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-[10px] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]" role="status">{notice}</p> : null}
      <form className="surface max-w-xl space-y-4 p-4 md:p-6" onSubmit={save}>
        <p className="font-medium">Trần Mai → Lê An · lớp 10A1</p>
        <div className="space-y-2">
          <Label htmlFor="status">Trạng thái</Label>
          <select id="status" className="h-11 w-full rounded-[10px] border border-[#7c8495] bg-white px-3" value={link.status} onChange={(event) => setLink({ ...link, status: event.target.value as LinkState["status"] })}>
            <option value="pending">Chưa xác minh</option>
            <option value="active">Đang hiệu lực</option>
            <option value="revoked">Đã thu hồi</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reason">Lý do</Label>
          <Textarea id="reason" className="min-h-28 rounded-[10px]" value={link.reason} onChange={(event) => setLink({ ...link, reason: event.target.value })} required />
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu liên kết"}</Button>
      </form>
    </div>
  )
}
