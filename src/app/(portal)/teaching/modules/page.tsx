"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading } from "@/components/state"

type Item = {
  key: string
  position: number
  type: string
  title: string
  completion: { kind: string }
  visible: boolean
  body?: string
  prompt?: string
  href?: string
  dueAt?: string | null
}
type Draft = { key: string; title: string; policy: { mode: string; sequential: boolean }; items: Item[] }
type Release = { releaseKey: string; dueAt: string | null; snapshot: { key: string; title: string } }
type Work = { moduleReleaseKey: string; text: string; submittedAt: string }
type Payload = {
  revision: number
  weekLabel: string
  classDeliveryEnabled: boolean
  drafts: Draft[]
  pathRelease: { modules: Release[] } | null
  assignmentWork: Work[]
}

export default function ModulesPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [selectedKey, setSelectedKey] = useState("")
  const [title, setTitle] = useState("")
  const [pageBody, setPageBody] = useState("")
  const [assignmentPrompt, setAssignmentPrompt] = useState("")
  const [linkHref, setLinkHref] = useState("")
  const [dueAt, setDueAt] = useState("")
  const [newTitle, setNewTitle] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  function applyDraft(draft: Draft | undefined) {
    setSelectedKey(draft?.key ?? "")
    setTitle(draft?.title ?? "")
    setPageBody(draft?.items.find((item) => item.type === "page")?.body ?? "")
    setAssignmentPrompt(draft?.items.find((item) => item.type === "assignment")?.prompt ?? "")
    setLinkHref(draft?.items.find((item) => item.type === "link")?.href ?? "")
    setDueAt(draft?.items.find((item) => item.type === "assignment")?.dueAt ?? "")
  }

  async function load(preferKey = selectedKey) {
    const response = await fetch("/api/modules")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không tải được module.")
    setData(body)
    const current = body.drafts?.find((item: Draft) => item.key === preferKey) ?? body.drafts?.[0]
    applyDraft(current)
    return body as Payload
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function post(payload: Record<string, unknown>, done: string) {
    if (!data) return null
    setPending(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, expectedRevision: data.revision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Chưa lưu được.")
      setNotice(done)
      await load(String(body.key ?? payload.key ?? payload.moduleKey ?? selectedKey))
      return body
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
      return null
    } finally {
      setPending(false)
    }
  }

  async function fillSuggested() {
    if (!draft) return
    setPending(true)
    setError("")
    try {
      const response = await fetch(`/api/modules?suggest=${encodeURIComponent(draft.key)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Không tải được nội dung đề xuất.")
      if (!body.pageBody && !body.assignmentPrompt) {
        setNotice("Bản này chưa có nội dung đề xuất. Hãy viết bài học và đề bài tập.")
        return
      }
      setPageBody(body.pageBody || pageBody)
      setAssignmentPrompt(body.assignmentPrompt || assignmentPrompt)
      setLinkHref(body.linkHref || linkHref)
      setNotice(body.note)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading label="Đang mở bản soạn..." />
  const draft = data.drafts.find((item) => item.key === selectedKey) ?? data.drafts[0]
  const delivered = data.pathRelease?.modules.map((item) => item.snapshot.title) ?? []
  const deliveredKeys = new Set(data.pathRelease?.modules.map((item) => item.snapshot.key) ?? [])
  const submissions = (data.assignmentWork ?? []).filter((item) => item.moduleReleaseKey === `rel-${draft?.key ?? ""}`)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Soạn và giao bài</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">
          Tạo bài mới hoặc mở một bài có sẵn trong khóa đang chọn. Viết trang bài học và đề bài tập, đặt hạn nộp, lưu, rồi giao cho lớp 10A1. Học sinh chỉ thấy bài đã giao của khóa đó. Tuần đang chạy là {data.weekLabel}. Bài trên mục Khóa học của khóa này không đổi. Kho bài của khóa khác không bị giao theo.
        </p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="rounded-[10px] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]">{notice}</p> : null}
      <form className="surface flex flex-col gap-3 p-4 md:flex-row md:items-end" onSubmit={(event) => {
        event.preventDefault()
        void post({ action: "create-lesson", title: newTitle }, "Đã tạo bài ở dạng bản soạn. Học sinh chưa thấy.").then((body) => {
          if (body?.key) setNewTitle("")
        })
      }}>
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="new-title">Tên bài mới</Label>
          <Input id="new-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Ví dụ: Ôn if–else" />
        </div>
        <Button type="submit" disabled={pending || newTitle.trim().length < 3}>Thêm bài</Button>
      </form>
      <p className="text-sm text-[#5b6476]">
        Giao lớp đang {data.classDeliveryEnabled ? "bật" : "tắt"}. Đã giao: {delivered.length ? delivered.join(", ") : "chưa có bài nào."}
      </p>
      {data.drafts.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="draft">Chọn bài</Label>
          <select id="draft" className="h-11 w-full rounded-[10px] border border-[#7c8495] bg-white px-3" value={draft?.key ?? ""} onChange={(event) => {
            const next = data.drafts.find((item) => item.key === event.target.value)
            applyDraft(next)
            setConfirming(false)
          }}>
            {data.drafts.map((item) => (
              <option key={item.key} value={item.key}>{item.title} · {deliveredKeys.has(item.key) ? "đã giao" : "bản soạn"}</option>
            ))}
          </select>
        </div>
      ) : null}
      {draft ? (
        <form className="surface space-y-4 p-4 md:p-6" onSubmit={(event) => {
          event.preventDefault()
          void post({ action: "save-lesson", key: draft.key, title, pageBody, assignmentPrompt, linkHref, dueAt }, "Đã lưu bản soạn. Học sinh chưa thấy bài này cho tới khi bạn giao.")
        }}>
          <div className="space-y-2">
            <Label htmlFor="title">Tên bài</Label>
            <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lesson">Bài học</Label>
            <Textarea id="lesson" className="min-h-56 rounded-[10px]" value={pageBody} onChange={(event) => setPageBody(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task">Đề bài tập</Label>
            <Textarea id="task" className="min-h-40 rounded-[10px]" value={assignmentPrompt} onChange={(event) => setAssignmentPrompt(event.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="due">Hạn nộp bài tập</Label>
              <Input id="due" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="link">Liên kết đọc thêm, nếu có</Label>
              <Input id="link" value={linkHref} onChange={(event) => setLinkHref(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={pending} onClick={() => void fillSuggested()}>Đưa nội dung đề xuất vào ô soạn</Button>
            <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu bản soạn"}</Button>
            <Button type="button" variant="outline" disabled={pending || !data.classDeliveryEnabled} onClick={() => setConfirming(true)}>Giao bài này cho lớp</Button>
          </div>
          {data.classDeliveryEnabled ? null : <p className="text-sm text-[#92400e]">Quản trị cần bật giao lớp trước khi giao bài.</p>}
        </form>
      ) : (
        <Button type="button" onClick={() => void post({ action: "save-sample" }, "Đã tạo mẫu năm dòng ở dạng bản soạn.")}>Tạo mẫu năm dòng</Button>
      )}
      {confirming && draft ? (
        <section className="surface space-y-3 p-4 md:p-6">
          <h2 className="text-xl font-semibold">Giao “{title}” cho 10A1</h2>
          <p className="text-[#5b6476]">Học sinh thấy bản đã lưu. Sửa bản soạn sau đó chưa đổi bài trên lớp cho tới khi bạn giao lại. Bài đang học ở mục Khóa học giữ nguyên.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={() => {
              setConfirming(false)
              void post({ action: "deliver-module", moduleKey: draft.key }, `Đã giao “${title}” cho lớp.`)
            }}>{pending ? "Đang giao…" : "Giao bài này"}</Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Quay lại sửa</Button>
          </div>
        </section>
      ) : null}
      {draft && deliveredKeys.has(draft.key) ? (
        <section className="surface space-y-3 p-4 md:p-6">
          <h2 className="text-xl font-semibold">Bài tập đã nộp</h2>
          {submissions.length === 0 ? <p className="text-[#5b6476]">Chưa có bài nộp.</p> : null}
          {submissions.map((item) => (
            <p key={item.submittedAt} className="rounded-[10px] bg-[#f6f7fb] p-3 whitespace-pre-wrap">{item.text}</p>
          ))}
          <Button type="button" variant="outline" disabled={pending} onClick={() => void post({ action: "unpublish-module", moduleKey: draft.key }, "Đã thu bài khỏi lớp. Bản soạn vẫn còn.")}>Thu bài khỏi lớp</Button>
        </section>
      ) : null}
    </div>
  )
}
