"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading } from "@/components/state"

type QuizQuestion = { key: string; prompt: string; options: string[] }
type Item = {
  key: string
  position: number
  type: string
  title: string
  completion: { kind: string }
  body?: string
  prompt?: string
  href?: string
  quiz?: { questions: QuizQuestion[] }
}
type Release = {
  releaseKey: string
  snapshot: { key: string; title: string; summary: string; items: Item[] }
  lock: string[]
}
type Fact = { moduleReleaseKey: string; itemKey: string }
type Work = { moduleReleaseKey: string; itemKey: string; text: string; submittedAt: string }
type Payload = {
  revision: number
  weekLabel: string
  pathRelease: { modules: Release[] } | null
  facts: Fact[]
  assignmentWork: Work[]
}

const lockText: Record<string, string> = {
  schedule: "Chưa tới ngày mở.",
  prerequisite: "Bài tiên quyết chưa xong.",
  scope: "Bài này không thuộc lớp của bạn.",
}

export default function ClassworkPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [work, setWork] = useState<Record<string, string>>({})

  async function load() {
    const response = await fetch("/api/modules")
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Không tải được bài được giao.")
    setData(body)
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function post(payload: Record<string, unknown>, done: string) {
    if (!data) return
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
      if (!response.ok) throw new Error(body.error || "Chưa ghi được.")
      setNotice(done)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  if (error && !data) return <ErrorNote message={error} />
  if (!data) return <Loading label="Đang mở bài được giao..." />
  const modules = data.pathRelease?.modules ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bài được giao</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">
          Tuần {data.weekLabel}. Đây là bài giáo viên đã giao thêm. Bài đang học ở mục Khóa học vẫn mở riêng.
        </p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="rounded-[10px] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]">{notice}</p> : null}
      {modules.length === 0 ? (
        <p className="surface p-4 text-[#5b6476] md:p-6">Giáo viên chưa giao bài mới cho lớp.</p>
      ) : null}
      {modules.map((release) => {
        const done = new Set(data.facts.filter((fact) => fact.moduleReleaseKey === release.releaseKey).map((fact) => fact.itemKey))
        const locked = release.lock.filter((reason) => reason !== "scope")
        return (
          <article key={release.releaseKey} className="surface space-y-5 p-4 md:p-6">
            <div>
              <h2 className="text-xl font-semibold">{release.snapshot.title}</h2>
              <p className="mt-2 text-[#5b6476]">{release.snapshot.summary}</p>
              {locked.length ? <p className="mt-2 text-sm text-[#92400e]">{locked.map((reason) => lockText[reason] ?? reason).join(" ")}</p> : null}
            </div>
            {release.snapshot.items.filter((item) => item.type !== "header").map((item) => {
              const finished = done.has(item.key)
              if (item.type === "page") {
                return (
                  <section key={item.key} className="space-y-3">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="whitespace-pre-wrap text-[#22263b]">{item.body || "Giáo viên chưa viết nội dung bài học."}</p>
                    <Button type="button" disabled={pending || finished || locked.length > 0} onClick={() => void post({ action: "mark-done", releaseKey: release.releaseKey, itemKey: item.key }, "Đã ghi nhận bạn đọc xong bài học.")}>
                      {finished ? "Đã đọc" : "Đánh dấu đã đọc"}
                    </Button>
                  </section>
                )
              }
              if (item.type === "link") {
                return (
                  <section key={item.key}>
                    {item.href ? <a className="font-medium text-[#5150df]" href={item.href}>{item.title}</a> : <p>{item.title}</p>}
                  </section>
                )
              }
              if (item.type === "assignment") {
                const earlier = release.snapshot.items.some((candidate) => candidate.position < item.position && candidate.completion.kind !== "none" && candidate.type !== "header" && !done.has(candidate.key))
                const previous = data.assignmentWork.filter((entry) => entry.moduleReleaseKey === release.releaseKey && entry.itemKey === item.key).at(-1)
                const field = `${release.releaseKey}:${item.key}`
                return (
                  <section key={item.key} className="space-y-3">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="whitespace-pre-wrap text-[#22263b]">{item.prompt || "Giáo viên chưa viết đề bài tập."}</p>
                    {previous ? <p className="rounded-[10px] bg-[#f6f7fb] p-3 text-sm whitespace-pre-wrap">Bài đã nộp: {previous.text}</p> : null}
                    <div className="space-y-2">
                      <Label htmlFor={field}>Bài làm</Label>
                      <Textarea id={field} className="min-h-32 rounded-[10px]" value={work[field] ?? ""} onChange={(event) => setWork({ ...work, [field]: event.target.value })} />
                    </div>
                    <Button type="button" disabled={pending || locked.length > 0 || earlier} onClick={() => void post({ action: "submit-assignment", releaseKey: release.releaseKey, itemKey: item.key, text: work[field] ?? "" }, "Đã nộp bài tập.")}>
                      {finished ? "Nộp lại" : "Nộp bài tập"}
                    </Button>
                    {earlier ? <p className="text-sm text-[#5b6476]">Hãy đọc xong bài học trước khi nộp bài tập.</p> : null}
                  </section>
                )
              }
              if (item.type === "quiz" && item.quiz) {
                const field = `${release.releaseKey}:${item.key}`
                const chosen = answers[field] ?? item.quiz.questions.map(() => -1)
                return (
                  <section key={item.key} className="space-y-4">
                    <h3 className="font-semibold">{item.title}</h3>
                    {item.quiz.questions.map((question, index) => (
                      <fieldset key={question.key} className="space-y-2">
                        <legend className="font-medium">{question.prompt}</legend>
                        {question.options.map((option, optionIndex) => (
                          <label key={optionIndex} className="flex min-h-11 items-start gap-2">
                            <input type="radio" name={`${field}-${index}`} checked={chosen[index] === optionIndex} onChange={() => {
                              const next = chosen.slice()
                              next[index] = optionIndex
                              setAnswers({ ...answers, [field]: next })
                            }} />
                            <span>{option}</span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    <Button type="button" disabled={pending || locked.length > 0} onClick={() => void post({ action: "quiz", releaseKey: release.releaseKey, itemKey: item.key, answers: chosen }, "Đã nộp bài luyện tập.")}>
                      Nộp bài luyện tập
                    </Button>
                  </section>
                )
              }
              return null
            })}
          </article>
        )
      })}
    </div>
  )
}
