"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading } from "@/components/state"

type QuizItem = { id: string; prompt: string; choices: string[]; answer: number; explain: string }
type ModuleDoc = {
  title: string
  summary: string
  exploreTitle: string
  exploreBody: string[]
  practiceTitle: string
  practicePrompt: string
  quiz: QuizItem[]
  status: "draft" | "published"
  version: number
  updatedAt: string | null
}

export default function ContentEditPage() {
  const [draft, setDraft] = useState<ModuleDoc | null>(null)
  const [explore, setExplore] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    fetch("/api/content")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được bản nháp.")
        setDraft(body.draft)
        setRevision(body.revision ?? 0)
        setExplore((body.draft.exploreBody as string[]).join("\n\n"))
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  function payload(): ModuleDoc | null {
    if (!draft) return null
    return { ...draft, exploreBody: explore.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean) }
  }

  async function save() {
    const next = payload()
    if (!next) return
    setPending(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", draft: next, expectedRevision: revision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Chưa lưu được bản nháp.")
      setDraft(body.draft)
      if (typeof body.revision === "number") setRevision(body.revision)
      setNotice("Đã lưu bản nháp. Học sinh chưa thấy thay đổi này.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  async function publish() {
    setPending(true)
    setError("")
    setNotice("")
    try {
      const saved = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", draft: payload(), expectedRevision: revision }),
      })
      const savedBody = await saved.json()
      if (!saved.ok) throw new Error(savedBody.error || "Chưa lưu được trước khi phát hành.")
      const response = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", expectedRevision: savedBody.revision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Chưa phát hành được.")
      setNotice(`Đã phát hành phiên bản ${body.published.version}. Học sinh thấy bản này.`)
      setConfirming(false)
      setDraft({ ...body.published, status: "draft" })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  if (error && !draft) return <ErrorNote message={error} />
  if (!draft) return <Loading label="Đang mở bản nháp..." />

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[#5b6476]">
          <Link className="font-medium text-[#5150df]" href="/teaching/content">Nội dung khóa học</Link>
          {" · "}soạn mô-đun
        </p>
        <h1 className="mt-2 text-2xl leading-tight font-bold md:text-[28px]">Sửa bản nháp</h1>
        <p className="mt-2 text-[#5b6476]">Đáp án luyện tập chỉ người soạn thấy. Học sinh không nhận đáp án trước khi nộp.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-[10px] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]" role="status">{notice}</p> : null}
      <form className="surface space-y-4 p-4 md:p-6" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Tên bài" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
        <Field label="Tóm tắt" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} />
        <Field label="Tiêu đề phần khám phá" value={draft.exploreTitle} onChange={(exploreTitle) => setDraft({ ...draft, exploreTitle })} />
        <div className="space-y-2">
          <Label htmlFor="explore">Nội dung khám phá</Label>
          <Textarea id="explore" className="min-h-40 rounded-[10px]" value={explore} onChange={(event) => setExplore(event.target.value)} />
          <p className="text-sm text-[#5b6476]">Ngăn cách mỗi đoạn bằng một dòng trống.</p>
        </div>
        <Field label="Tiêu đề thực hành" value={draft.practiceTitle} onChange={(practiceTitle) => setDraft({ ...draft, practiceTitle })} />
        <div className="space-y-2">
          <Label htmlFor="prompt">Đề thực hành</Label>
          <Textarea id="prompt" className="min-h-28 rounded-[10px]" value={draft.practicePrompt} onChange={(event) => setDraft({ ...draft, practicePrompt: event.target.value })} />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Luyện tập · dành cho người soạn</h2>
          {draft.quiz.map((question, index) => (
            <fieldset key={question.id} className="space-y-3 rounded-2xl border border-[#d9ddea] p-4">
              <legend className="px-1 text-sm font-medium">Câu {index + 1}</legend>
              <Label htmlFor={`q-${index}`}>Đề bài</Label>
              <Textarea id={`q-${index}`} className="rounded-[10px]" value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} />
              {question.choices.map((choice, choiceIndex) => (
                <div key={choiceIndex} className="space-y-1">
                  <Label htmlFor={`c-${index}-${choiceIndex}`}>Lựa chọn {choiceIndex + 1}</Label>
                  <Textarea id={`c-${index}-${choiceIndex}`} className="rounded-[10px] font-mono" value={choice} onChange={(event) => {
                    const choices = question.choices.slice()
                    choices[choiceIndex] = event.target.value
                    updateQuestion(index, { choices })
                  }} />
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor={`a-${index}`}>Đáp án đúng</Label>
                <select id={`a-${index}`} className="h-11 w-full rounded-[10px] border border-[#7c8495] bg-white px-3" value={question.answer} onChange={(event) => updateQuestion(index, { answer: Number(event.target.value) })}>
                  {question.choices.map((_, choiceIndex) => (
                    <option key={choiceIndex} value={choiceIndex}>Lựa chọn {choiceIndex + 1}</option>
                  ))}
                </select>
              </div>
              <Label htmlFor={`e-${index}`}>Giải thích sau khi nộp</Label>
              <Textarea id={`e-${index}`} className="rounded-[10px]" value={question.explain} onChange={(event) => updateQuestion(index, { explain: event.target.value })} />
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu bản nháp"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(true)}>Kiểm tra và công bố</Button>
        </div>
      </form>
      {confirming ? (
        <section className="surface space-y-3 p-4 md:p-6">
          <h2 className="text-xl font-semibold">Phát hành phiên bản mới</h2>
          <p className="text-[#5b6476]">Phiên bản này sẽ được giữ cố định cho học sinh. Thay đổi sau đó tạo một bản nháp mới, không sửa bài đã phát hành.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={pending} onClick={() => void publish()}>{pending ? "Đang phát hành…" : "Phát hành phiên bản này"}</Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Tiếp tục chỉnh sửa</Button>
          </div>
        </section>
      ) : null}
    </div>
  )

  function updateQuestion(index: number, patch: Partial<QuizItem>) {
    setDraft((current) => {
      if (!current) return current
      const quiz = current.quiz.slice()
      quiz[index] = { ...quiz[index], ...patch }
      return { ...current, quiz }
    })
  }
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
