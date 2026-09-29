"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorNote, Loading } from "@/components/state"

type Item = { key: string; position: number; type: string; title: string; completion: { kind: string }; visible: boolean }
type Draft = { key: string; title: string; policy: { mode: string; sequential: boolean }; items: Item[] }
type Payload = {
  revision: number
  weekLabel: string
  classDeliveryEnabled: boolean
  drafts: Draft[]
}

export default function ModulesPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [title, setTitle] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  async function load() {
    const response = await fetch("/api/modules")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không tải được module.")
    setData(body)
    setTitle(body.drafts?.[0]?.title ?? "")
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function post(payload: Record<string, unknown>) {
    if (!data) return
    setError("")
    const response = await fetch("/api/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, expectedRevision: data.revision }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error || "Chưa lưu được.")
      return
    }
    setNotice(payload.action === "save-sample" ? "Đã tạo mẫu năm dòng ở dạng bản soạn." : "Đã lưu tiêu đề bản soạn.")
    await load()
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading label="Đang mở bản soạn module..." />
  const draft = data.drafts[0]
  const requirements = draft?.items.filter((item) => item.visible && item.type !== "header" && item.completion.kind !== "none").length ?? 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Module soạn thảo</h1>
        <p className="mt-1 text-muted-foreground">
          Tuần lớp đang chạy là {data.weekLabel}. Giao lớp đang {data.classDeliveryEnabled ? "bật" : "tắt"}. Bản soạn không đổi lịch lớp và không phát hành kho 34 bài.
        </p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="text-sm font-medium text-primary">{notice}</p> : null}
      {draft ? (
        <div className="space-y-4 rounded-2xl border bg-card p-4">
          <label className="block text-sm font-medium">
            Tiêu đề bản soạn
            <Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <p className="text-sm text-muted-foreground">Policy {draft.policy.mode}, đi lần lượt: {draft.policy.sequential ? "có" : "không"}. Requirement tính mẫu số: {requirements}.</p>
          <ol className="space-y-1 text-sm">
            {draft.items.map((item) => (
              <li key={item.key}>
                {item.position}. {item.type} · {item.title} · {item.completion.kind}
              </li>
            ))}
          </ol>
          <Button type="button" onClick={() => post({ action: "save", key: draft.key, title })}>Lưu bản soạn</Button>
        </div>
      ) : (
        <Button type="button" onClick={() => post({ action: "save-sample" })}>Tạo mẫu năm dòng</Button>
      )}
    </div>
  )
}
