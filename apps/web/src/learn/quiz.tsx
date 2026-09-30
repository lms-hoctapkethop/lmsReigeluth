import { useEffect, useRef, useState } from 'react'
import { RichView } from '../studio/rich-view.tsx'
import { ApiError, apiJson } from './http.ts'
import styles from './learn.module.css'

type Option = { id: string; label: string }
type Question = { id: string; qtype: string; stem: unknown; options?: Option[]; bloomTarget: number; hintsAvailable: number }
type QuestionState = {
  questionId: string
  answered: boolean
  tryNo: number | null
  hintsUsed: number
  revealed: boolean
  correct?: boolean | null
  feedback?: string | null
  openedHints?: string[]
}
type Attempt = {
  id: string
  purpose: string
  status: string
  questions: Question[]
  questionStates: QuestionState[]
  score: number | null
  maxScore: number | null
}

const formatMessage = 'Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5'

export function QuizPanel({ releaseId, itemId, csrf }: { releaseId: string; itemId: string; csrf: string }) {
  const startKey = useRef(crypto.randomUUID())
  const answerKey = useRef(crypto.randomUUID())
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [active, setActive] = useState(0)
  const [limit, setLimit] = useState(false)

  useEffect(() => {
    let cancelled = false
    void apiJson<Attempt>(`/api/v1/module-releases/${releaseId}/items/${itemId}/attempts`, csrf, {
      method: 'POST',
      headers: { 'idempotency-key': startKey.current },
      body: '{}',
    }).then((row) => {
      if (!cancelled) setAttempt(row)
    }).catch((reason: unknown) => {
      if (cancelled) return
      if (reason instanceof ApiError && reason.code === 'ATTEMPT_LIMIT_REACHED') setLimit(true)
      else setError('Không mở được bài làm.')
    })
    return () => {
      cancelled = true
    }
  }, [releaseId, itemId, csrf])

  async function reload(id: string): Promise<void> {
    setAttempt(await apiJson<Attempt>(`/api/v1/attempts/${id}`))
  }

  async function sendAnswer(question: Question, response: Record<string, unknown>): Promise<void> {
    if (!attempt) return
    setFieldError((current) => ({ ...current, [question.id]: '' }))
    try {
      await apiJson(`/api/v1/attempts/${attempt.id}/questions/${question.id}/answers`, csrf, {
        method: 'POST',
        headers: { 'idempotency-key': answerKey.current },
        body: JSON.stringify({ response }),
      })
      answerKey.current = crypto.randomUUID()
      await reload(attempt.id)
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 422 && (question.qtype === 'numeric' || question.qtype === 'short_text')) {
        setFieldError((current) => ({ ...current, [question.id]: formatMessage }))
        return
      }
      if (reason instanceof ApiError && reason.code === 'ALREADY_ANSWERED') return
      setError('Chưa lưu được câu trả lời.')
    }
  }

  async function hint(question: Question, used: number): Promise<void> {
    if (!attempt || used >= question.hintsAvailable) return
    await apiJson(`/api/v1/attempts/${attempt.id}/questions/${question.id}/hints`, csrf, { method: 'POST' })
    await reload(attempt.id)
  }

  async function submit(): Promise<void> {
    if (!attempt) return
    const key = crypto.randomUUID()
    await apiJson(`/api/v1/attempts/${attempt.id}/submit`, csrf, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: '{}',
    })
    await reload(attempt.id)
  }

  if (limit) return <p>Đã hoàn thành</p>
  if (error) return <p role="alert">{error}</p>
  if (!attempt) return <p>Đang mở bài làm.</p>
  const questions = attempt.questions
  return (
    <div className={styles.quiz}>
      {attempt.status === 'submitted' ? <p>Đã hoàn thành</p> : null}
      <div className={styles.quizList}>
        {questions.map((question, index) => {
          const state = attempt.questionStates.find((row) => row.questionId === question.id)
          const used = state?.hintsUsed ?? 0
          return (
            <article key={question.id} className={styles.quizCard} data-active={index === active ? 'true' : 'false'}>
              <h3>Câu {index + 1}</h3>
              <RichView doc={question.stem} />
              {question.qtype === 'single_choice' || question.qtype === 'multi_choice' ? (
                <div className={styles.row}>
                  {(question.options ?? []).map((option) => (
                    <button key={option.id} type="button" onClick={() => void sendAnswer(question, question.qtype === 'multi_choice' ? { options: [option.id] } : { option: option.id })}>
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <label>
                  Câu trả lời
                  <input
                    data-quiz-answer="true"
                    inputMode={question.qtype === 'numeric' ? 'decimal' : 'text'}
                    value={draft[question.id] ?? ''}
                    onChange={(event) => setDraft((current) => ({ ...current, [question.id]: event.target.value }))}
                  />
                </label>
              )}
              {fieldError[question.id] ? <p role="alert">{fieldError[question.id]}</p> : null}
              {question.qtype === 'numeric' || question.qtype === 'short_text' ? (
                <button type="button" onClick={() => void sendAnswer(question, { raw: draft[question.id] ?? '' })}>Lưu câu trả lời</button>
              ) : null}
              {attempt.purpose === 'diagnostic' || attempt.purpose === 'exit_ticket' ? (
                <button type="button" onClick={() => void sendAnswer(question, { notLearned: true })}>Em chưa học phần này</button>
              ) : null}
              {state?.answered && !state.revealed ? <p>Đã lưu</p> : null}
              {state?.revealed && state.correct === true ? <p>Đúng</p> : null}
              {state?.revealed && state.correct === false ? <p>Chưa đúng</p> : null}
              {state?.revealed && state.feedback ? <p className={styles.misconception}>{state.feedback}</p> : null}
              {(state?.openedHints ?? []).map((text, hintIndex) => <p key={text}>Gợi ý {hintIndex + 1}: {text}</p>)}
              {attempt.purpose === 'practice' && used < question.hintsAvailable && state?.correct !== true ? (
                <button type="button" onClick={() => void hint(question, used)}>{`Xem gợi ý ${used + 1}`}</button>
              ) : null}
            </article>
          )
        })}
      </div>
      <div className={styles.onlyMobile}>
        <button type="button" onClick={() => setActive((current) => Math.max(0, current - 1))}>Câu trước</button>
        <button type="button" onClick={() => setActive((current) => Math.min(questions.length - 1, current + 1))}>Câu sau</button>
      </div>
      {attempt.status === 'in_progress' ? <button type="button" onClick={() => void submit()}>Nộp bài</button> : null}
    </div>
  )
}
