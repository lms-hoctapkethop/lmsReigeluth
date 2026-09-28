"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNote, Loading, formatWhen } from "@/components/state"

type QuizQuestion = { id: string; prompt: string; choices: string[] }
type Learn = {
  quiz: QuizQuestion[]
  lastQuiz: { score: number; total: number; submittedAt: string; explanations: { id: string; correct: boolean; explain: string }[] } | null
}
type Teaching = {
  latest: { versionNo: number; code: string; reflection: string; receipt: string; submittedAt: string } | null
  review: { publishedAt: string; criteria: { label: string; met: boolean; note: string }[] } | null
  criteria: { id: string; label: string }[]
}
type Me = { user: { role: string } }

export default function AssessmentPage() {
  const [role, setRole] = useState<string>("")
  const [learn, setLearn] = useState<Learn | null>(null)
  const [queue, setQueue] = useState<Teaching | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [marks, setMarks] = useState<Record<string, { met: boolean; note: string }>>({})
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    async function run() {
      const me = (await (await fetch("/api/session")).json()) as Me
      setRole(me.user.role)
      if (me.user.role === "teacher") {
        const response = await fetch("/api/teaching")
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setQueue(body)
        const initial: Record<string, { met: boolean; note: string }> = {}
        for (const criterion of body.criteria) initial[criterion.id] = { met: false, note: "" }
        setMarks(initial)
      } else {
        const response = await fetch("/api/learn")
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setLearn(body)
        setAnswers(body.quiz.map(() => -1))
      }
    }
    run().catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function submitQuiz() {
    setError("")
    const response = await fetch("/api/learn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quiz", answers }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error)
      return
    }
    setLearn((current) => (current ? { ...current, lastQuiz: body.attempt } : current))
    setNotice(body.note)
  }

  async function publish() {
    if (!queue?.latest) return
    setError("")
    const response = await fetch("/api/teaching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionNo: queue.latest.versionNo,
        marks: Object.entries(marks).map(([id, value]) => ({ id, ...value })),
      }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error)
      return
    }
    setNotice("Đã công bố nhận xét và cập nhật hồ sơ.")
    const next = await fetch("/api/teaching")
    setQueue(await next.json())
  }

  if (error && !learn && !queue) return <ErrorNote message={error} />
  if (!role) return <Loading label="Đang mở đánh giá..." />

  if (role === "teacher") {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">Hàng chờ phản hồi</h1>
        <p className="text-muted-foreground">Nhận xét chưa công bố không hiện với học sinh và phụ huynh. Trang này công bố ngay khi bạn xác nhận.</p>
        {error ? <ErrorNote message={error} /> : null}
        {notice ? <p role="status" className="text-sm font-medium text-primary">{notice}</p> : null}
        {!queue?.latest ? <p className="rounded-lg bg-muted px-3 py-3 text-sm">Chưa có bài để chấm.</p> : null}
        {queue?.latest ? (
          <article className="surface space-y-4 p-5">
            <div>
              <h2 className="font-semibold">Lê An · lần nộp {queue.latest.versionNo}</h2>
              <p className="text-sm text-muted-foreground">
                {queue.latest.receipt} · {formatWhen(queue.latest.submittedAt)}
              </p>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{queue.latest.code}</pre>
            <p>{queue.latest.reflection}</p>
            {queue.review ? <p className="text-sm text-primary">Đã công bố lúc {formatWhen(queue.review.publishedAt)}. Công bố lại sẽ ghi quyết định mới, giữ lịch sử cũ.</p> : null}
            <ul className="space-y-4">
              {queue.criteria.map((criterion) => (
                <li key={criterion.id} className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={marks[criterion.id]?.met ?? false}
                      onCheckedChange={(checked) =>
                        setMarks((current) => ({ ...current, [criterion.id]: { ...current[criterion.id], met: Boolean(checked) } }))
                      }
                    />
                    {criterion.label}
                  </Label>
                  <Textarea
                    value={marks[criterion.id]?.note ?? ""}
                    onChange={(event) =>
                      setMarks((current) => ({ ...current, [criterion.id]: { ...current[criterion.id], note: event.target.value } }))
                    }
                    placeholder="Nhận xét cho tiêu chí này"
                  />
                </li>
              ))}
            </ul>
            <Button onClick={publish}>Công bố nhận xét</Button>
          </article>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Luyện tập trắc nghiệm</h1>
      <p className="text-muted-foreground">Đáp án được chấm trên máy chủ. Điểm này không tự xác nhận mục tiêu của bài thực hành.</p>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
      {!learn ? <Loading /> : null}
      {learn?.quiz.map((question, index) => (
        <fieldset key={question.id} className="surface p-4">
          <legend className="font-medium">{index + 1}. {question.prompt}</legend>
          <div className="mt-3 space-y-2">
            {question.choices.map((choice, choiceIndex) => (
              <label key={choice} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1"
                  name={question.id}
                  checked={answers[index] === choiceIndex}
                  onChange={() => setAnswers((current) => current.map((value, item) => (item === index ? choiceIndex : value)))}
                />
                <span className="whitespace-pre-wrap">{choice}</span>
              </label>
            ))}
          </div>
          {learn.lastQuiz ? <p className="mt-3 text-sm text-muted-foreground">{learn.lastQuiz.explanations.find((item) => item.id === question.id)?.explain}</p> : null}
        </fieldset>
      ))}
      {role === "student" && learn ? (
        <Button onClick={submitQuiz}>Nộp bài luyện tập</Button>
      ) : null}
      {learn?.lastQuiz ? (
        <p className="text-sm">
          Lần gần nhất: {learn.lastQuiz.score}/{learn.lastQuiz.total} câu đúng, lúc {formatWhen(learn.lastQuiz.submittedAt)}.
        </p>
      ) : null}
    </div>
  )
}
