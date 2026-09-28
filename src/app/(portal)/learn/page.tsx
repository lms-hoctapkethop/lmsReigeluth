"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading, formatWhen } from "@/components/state"

type Draft = { code: string; reflection: string; version: number; updatedAt: string | null }
type Payload = {
  canEdit: boolean
  exploreDone: boolean
  explore: { title: string; body: string[] }
  practice: {
    title: string
    prompt: string
    draft?: Draft
    latest: { versionNo: number; code: string; reflection: string; submittedAt: string; receipt: string } | null
  }
}

export default function LearnPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [code, setCode] = useState("")
  const [reflection, setReflection] = useState("")
  const [version, setVersion] = useState(1)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)

  async function load() {
    const response = await fetch("/api/learn")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không mở được bài học.")
    setData(body)
    if (body.practice.draft) {
      setCode(body.practice.draft.code)
      setReflection(body.practice.draft.reflection)
      setVersion(body.practice.draft.version)
      setDirty(false)
    }
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function post(payload: Record<string, unknown>) {
    setPending(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await response.json()
      if (!response.ok) {
        if (body.draft) {
          setCode(body.draft.code)
          setReflection(body.draft.reflection)
          setVersion(body.draft.version)
          setDirty(false)
        }
        setError(body.error || "Không lưu được.")
        return null
      }
      return body
    } catch {
      setError("Mất kết nối. Nội dung trên màn hình vẫn còn, chưa được ghi là đã lưu.")
      return null
    } finally {
      setPending(false)
    }
  }

  async function saveDraft() {
    const body = await post({ action: "save-draft", code, reflection, version })
    if (!body) return
    setVersion(body.draft.version)
    setDirty(false)
    setNotice("Đã lưu trên máy chủ.")
  }

  async function submit() {
    const body = await post({
      action: "submit",
      code,
      reflection,
      version,
      idempotencyKey: crypto.randomUUID(),
    })
    if (!body) return
    setNotice(`Đã nộp. Mã biên nhận ${body.receipt.receipt}.`)
    await load()
  }

  async function markRead() {
    const body = await post({ action: "mark-read" })
    if (!body) return
    setData((current) => (current ? { ...current, exploreDone: true } : current))
    setNotice("Đã ghi nhận bạn đọc xong phần khám phá.")
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading label="Đang mở bài học..." />

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Không gian học tập</h1>
          <p className="mt-1 text-muted-foreground">Bài 03 · Rẽ nhánh if–else. Hạn thực hành 01/10/2026.</p>
        </div>
        {error ? <ErrorNote message={error} /> : null}
        {notice ? <p role="status" className="text-sm font-medium text-primary">{notice}</p> : null}
        {dirty ? <p className="text-sm text-muted-foreground">Có nội dung chưa lưu.</p> : null}
        <Tabs defaultValue="explore">
          <TabsList>
            <TabsTrigger value="explore">Khám phá</TabsTrigger>
            <TabsTrigger value="practice">Thực hành</TabsTrigger>
          </TabsList>
          <TabsContent value="explore" className="surface mt-4 p-5">
            <h2 className="text-lg font-semibold">{data.explore.title}</h2>
            <div className="mt-3 space-y-3 leading-relaxed">
              {data.explore.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-3 text-sm">{`diem = 7\nif diem >= 5:\n    print("Đạt")\nelse:\n    print("Chưa đạt")`}</pre>
            {data.canEdit ? (
              <Button className="mt-4" variant="outline" onClick={markRead} disabled={data.exploreDone || pending}>
                {data.exploreDone ? "Đã đọc xong" : "Tôi đã đọc xong"}
              </Button>
            ) : data.exploreDone ? (
              <Badge className="mt-4" variant="secondary">Học sinh đã đọc</Badge>
            ) : null}
          </TabsContent>
          <TabsContent value="practice" className="surface mt-4 space-y-4 p-5">
            <h2 className="text-lg font-semibold">{data.practice.title}</h2>
            <p>{data.practice.prompt}</p>
            {data.canEdit && data.practice.draft ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="code">Mã Python</Label>
                  <Textarea id="code" className="min-h-40 font-mono" value={code} onChange={(event) => { setCode(event.target.value); setDirty(true) }} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reflection">Nhận xét của tôi</Label>
                  <Textarea id="reflection" className="min-h-28" value={reflection} onChange={(event) => { setReflection(event.target.value); setDirty(true) }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={saveDraft} disabled={pending}>Lưu bản nháp</Button>
                  <Button onClick={submit} disabled={pending}>Nộp bài</Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {data.practice.draft.updatedAt ? `Bản máy chủ phiên ${version}, lưu lúc ${formatWhen(data.practice.draft.updatedAt)}.` : "Chưa có bản lưu trên máy chủ."}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Bạn xem bài đã nộp, không viết thay học sinh.</p>
            )}
            {data.practice.latest ? (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">Lần nộp {data.practice.latest.versionNo}</p>
                <p>Biên nhận {data.practice.latest.receipt}</p>
                <p>Lúc {formatWhen(data.practice.latest.submittedAt)}</p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono">{data.practice.latest.code}</pre>
                <p className="mt-2">{data.practice.latest.reflection}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Chưa có lần nộp nào.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <aside className="surface h-fit p-4">
        <h2 className="font-semibold">Cách hoàn thành</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>Đọc xong: ghi nhận đã tham gia.</li>
          <li>Thực hành: nộp mã và lời giải thích.</li>
          <li>Đạt mục tiêu: chỉ khi giáo viên công bố nhận xét.</li>
        </ul>
      </aside>
    </div>
  )
}
