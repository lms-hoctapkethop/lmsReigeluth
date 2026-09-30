import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { ApiError, apiJson } from '../learn/http.ts'
import styles from './desk.module.css'

type Level = 'meets' | 'developing' | 'not_yet' | 'not_shown'
type Criterion = { criterionId: string; title: string; level: Level | null; note: string | null; levels: { meets: string; developing: string; notYet: string } }
type Requirement = { id: string; code791Stem: string; text: string }
type Draft = {
  id: string
  revision: number
  submissionId: string
  submissionVersionId: string
  isCurrentVersion: boolean
  currentVersionId: string
  learnerName: string
  itemTitle: string
  versionNo: number
  comment: string | null
  criteria: Criterion[]
  requirements: Requirement[]
}
type Submission = {
  versions: { id: string; versionNo: number; submittedAt: string; body: { body?: Body; reflection?: string; fileIds?: string[] } | null }[]
}
type Body = { type?: string; text?: string; language?: string; testCases?: { input: string; expected: string; actual?: string }[]; doc?: { blocks?: { children?: { text?: string }[] }[] } }

const levelKeys: Record<string, Level> = { '1': 'meets', '2': 'developing', '3': 'not_yet', '4': 'not_shown' }
const levelLabel: Record<Level, string> = { meets: 'Đạt', developing: 'Đang phát triển', not_yet: 'Chưa đạt', not_shown: 'Chưa thể hiện' }

function linesOf(text: string) {
  const lines = text.split('\n')
  return (
    <div className={styles.gutter}>
      <div>{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
      <pre>{text}</pre>
    </div>
  )
}

function SubmissionPane({ version }: { version: Submission['versions'][number] | undefined }) {
  const body = version?.body?.body
  if (!body) return <p>Chưa có nội dung bài nộp.</p>
  return (
    <div className={styles.stack}>
      {body.type === 'code' ? linesOf(body.text ?? '') : null}
      {body.type === 'text' ? <p>{body.text}</p> : null}
      {body.type === 'rich' ? <p>{body.doc?.blocks?.map((block) => block.children?.map((child) => child.text ?? '').join('') ?? '').join('\n')}</p> : null}
      {body.type === 'code' && body.testCases && body.testCases.length > 0 ? (
        <table>
          <caption>Ca thử</caption>
          <thead><tr><th>Đầu vào</th><th>Mong đợi</th><th>Thực tế</th></tr></thead>
          <tbody>
            {body.testCases.map((row, index) => (
              <tr key={index}><td>{row.input}</td><td>{row.expected}</td><td>{row.actual ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {version?.body?.reflection ? <p>Lời giải thích: {version.body.reflection}</p> : null}
      {version?.body?.fileIds && version.body.fileIds.length > 0 ? (
        <ul>{version.body.fileIds.map((id) => <li key={id}>Tệp {id}</li>)}</ul>
      ) : null}
    </div>
  )
}

export function ReviewDesk() {
  const { submissionVersionId = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const client = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const review = useQuery({
    queryKey: ['review', submissionVersionId],
    queryFn: () => apiJson<Draft>(`/api/v1/submission-versions/${submissionVersionId}/reviews`, me.csrfToken, { method: 'POST' }),
    refetchInterval: 2000,
  })
  const submission = useQuery({
    queryKey: ['submission', review.data?.submissionId],
    enabled: Boolean(review.data?.submissionId),
    queryFn: () => apiJson<Submission>(`/api/v1/submissions/${review.data?.submissionId ?? ''}`),
  })
  const [comment, setComment] = useState('')
  const [criteria, setCriteria] = useState<Criterion[]>([])
  const [focus, setFocus] = useState(0)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [marks, setMarks] = useState<Record<string, 'achieved' | 'not_yet'>>({})
  const [outcome, setOutcome] = useState<'reviewed' | 'changes_requested'>('reviewed')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const hydrated = useRef('')

  useEffect(() => {
    if (!review.data || hydrated.current === review.data.id) return
    hydrated.current = review.data.id
    setComment(review.data.comment ?? '')
    setCriteria(review.data.criteria)
  }, [review.data])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable)) return
      if (dialogRef.current?.open) return
      const key = event.key.toLowerCase()
      if (levelKeys[event.key]) {
        const level = levelKeys[event.key]
        setCriteria((rows) => rows.map((row, index) => (index === focus && level ? { ...row, level } : row)))
        event.preventDefault()
      }
      if (key === 'j' || key === 'k') {
        setFocus((index) => {
          const next = key === 'j' ? index + 1 : index - 1
          return Math.min(Math.max(next, 0), Math.max(criteria.length - 1, 0))
        })
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [criteria.length, focus])

  if (review.isLoading) return <p>Đang tải bàn chấm.</p>
  if (review.error instanceof ApiError && (review.error.status === 404 || review.error.status === 403)) {
    return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  }
  if (review.isError || !review.data) {
    return <p role="alert">Không tải được bài chấm. <button type="button" onClick={() => void review.refetch()}>Thử lại</button></p>
  }
  const draft = review.data
  const version = submission.data?.versions.find((row) => row.id === submissionVersionId)
  const current = !draft.isCurrentVersion

  async function save(): Promise<Draft> {
    const saved = await apiJson<Draft>(`/api/v1/reviews/${draft.id}`, me.csrfToken, {
      method: 'PUT',
      headers: { 'if-match': `W/"${String(draft.revision)}"` },
      body: JSON.stringify({
        comment,
        criteria: criteria.map((row) => ({ criterionId: row.criterionId, level: row.level, note: row.note })),
      }),
    })
    client.setQueryData(['review', submissionVersionId], saved)
    setMessage('Đã lưu nháp.')
    return saved
  }

  async function confirmPublish() {
    setError('')
    try {
      const saved = await save()
      const decisions = saved.requirements.flatMap((requirement) => {
        if (!picked[requirement.id]) return []
        return [{ requirementId: requirement.id, decision: marks[requirement.id] ?? 'achieved', reason: reasons[requirement.id] ?? '' }]
      })
      await apiJson(`/api/v1/reviews/${saved.id}/publish`, me.csrfToken, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          expectedRevision: saved.revision,
          expectedSubmissionVersionId: saved.submissionVersionId,
          outcome,
          decisions,
        }),
      })
      dialogRef.current?.close()
      setMessage('Đã công bố nhận xét.')
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'INTERNAL'
      if (code === 'SUBMISSION_VERSION_CHANGED') setError('HS đã nộp phiên bản mới. Công bố bản này bị chặn.')
      else if (code === 'REVISION_CONFLICT') setError('Quyết định vừa đổi. Hãy mở lại bài và kiểm tra hồ sơ.')
      else setError('Chưa công bố được. Hãy kiểm tra mức tiêu chí và lý do.')
    }
  }

  return (
    <section className={styles.stack}>
      <div className={styles.row}>
        <h1>Chấm {draft.itemTitle}</h1>
        <Link to="/day/cham/phim">Phím tắt</Link>
      </div>
      <p>{draft.learnerName} · phiên bản {draft.versionNo}</p>
      {current ? (
        <p className={styles.banner} role="status">
          HS đã nộp phiên bản mới.{' '}
          <Link to={`/day/cham/bai/${draft.currentVersionId}`}>Mở phiên bản mới</Link>
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.desk}>
        <div className={styles.panel}>
          <h2>Bài nộp</h2>
          <div className={styles.row}>
            {submission.data?.versions.map((row) => (
              <Link key={row.id} to={`/day/cham/bai/${row.id}`} aria-current={row.id === submissionVersionId ? 'page' : undefined}>
                Phiên bản {row.versionNo}
              </Link>
            ))}
          </div>
          {submission.isLoading ? <p>Đang tải bài nộp.</p> : null}
          <SubmissionPane version={version} />
        </div>
        <div className={styles.panel}>
          <h2>Rubric</h2>
          {criteria.length === 0 ? <p>Bài này không có tiêu chí.</p> : null}
          {criteria.map((row, index) => (
            <article key={row.criterionId} className={styles.criterion} data-active={index === focus} tabIndex={0} onFocus={() => setFocus(index)}>
              <h3>{row.title}</h3>
              <div className={styles.levels} role="group" aria-label={row.title}>
                {(Object.keys(levelLabel) as Level[]).map((level) => (
                  <button key={level} type="button" aria-pressed={row.level === level} onClick={() => setCriteria((rows) => rows.map((item) => item.criterionId === row.criterionId ? { ...item, level } : item))}>
                    {levelLabel[level]}
                  </button>
                ))}
              </div>
              <p className={styles.muted}>{row.level ? row.levels[row.level === 'not_yet' ? 'notYet' : row.level === 'not_shown' ? 'notYet' : row.level] : 'Chưa chọn mức'}</p>
            </article>
          ))}
          <label>
            Nhận xét
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
          </label>
          <div className={styles.row}>
            <button type="button" onClick={() => void save().catch(() => setError('Chưa lưu được nháp.'))}>Lưu nháp</button>
            <button type="button" disabled={current} onClick={() => dialogRef.current?.showModal()}>Công bố</button>
          </div>
        </div>
      </div>
      <dialog ref={dialogRef} aria-labelledby="publish-title">
        <form method="dialog" className={styles.stack} onSubmit={(event) => { event.preventDefault(); void confirmPublish() }}>
          <h2 id="publish-title">Công bố cho {draft.learnerName}</h2>
          <p>Học sinh và phụ huynh sẽ thấy nhận xét đã công bố. Chỉ yêu cầu được tick mới có kết luận trên hồ sơ.</p>
          <label>
            Kết quả
            <select value={outcome} onChange={(event) => setOutcome(event.target.value as 'reviewed' | 'changes_requested')}>
              <option value="reviewed">Đã xem</option>
              <option value="changes_requested">Cần sửa</option>
            </select>
          </label>
          {draft.requirements.map((requirement) => (
            <div key={requirement.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked[requirement.id] === true}
                  onChange={(event) => setPicked((rows) => ({ ...rows, [requirement.id]: event.target.checked }))}
                />{' '}
                {requirement.code791Stem}
              </label>
              {picked[requirement.id] ? (
                <>
                  <label>
                    Mức kết luận {requirement.code791Stem}
                    <select value={marks[requirement.id] ?? 'achieved'} onChange={(event) => setMarks((rows) => ({ ...rows, [requirement.id]: event.target.value as 'achieved' | 'not_yet' }))}>
                      <option value="achieved">Đạt</option>
                      <option value="not_yet">Chưa đạt</option>
                    </select>
                  </label>
                  <textarea aria-label={`Lý do ${requirement.code791Stem}`} value={reasons[requirement.id] ?? ''} onChange={(event) => setReasons((rows) => ({ ...rows, [requirement.id]: event.target.value }))} />
                </>
              ) : null}
            </div>
          ))}
          <div className={styles.row}>
            <button type="submit">Xác nhận công bố</button>
            <button type="button" onClick={() => dialogRef.current?.close()}>Đóng</button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
