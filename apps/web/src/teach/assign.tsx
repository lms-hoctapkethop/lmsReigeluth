import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { apiJson } from '../learn/http.ts'
import styles from '../learn/learn.module.css'

type Offering = { id: string; title: string; courseId: string }
type ModuleRow = { id: string; title: string }
type Version = { id: string; versionNo: number; title: string }
type Release = { id: string; title: string; dueAt: string | null; acceptUntil: string | null; latePolicy: string; scheduleRevision: number }

function fromLocal(value: string): string | null {
  if (!value) return null
  return new Date(`${value}:00+07:00`).toISOString()
}

export function AssignWork() {
  const { id = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const client = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [title, setTitle] = useState('Đợt mới')
  const [availableFrom, setAvailableFrom] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [acceptUntil, setAcceptUntil] = useState('')
  const [latePolicy, setLatePolicy] = useState<'accept_marked' | 'reject'>('accept_marked')
  const [message, setMessage] = useState('')
  const offerings = useQuery({
    queryKey: ['offerings'],
    queryFn: () => apiJson<Offering[]>('/api/v1/offerings'),
  })
  const offering = offerings.data?.find((item) => item.id === id)
  const modules = useQuery({
    queryKey: ['course-modules', offering?.courseId],
    enabled: Boolean(offering?.courseId),
    queryFn: () => apiJson<ModuleRow[]>(`/api/v1/modules?courseId=${offering?.courseId ?? ''}`),
  })
  const versions = useQuery({
    queryKey: ['module-versions', moduleId],
    enabled: Boolean(moduleId),
    queryFn: () => apiJson<Version[]>(`/api/v1/modules/${moduleId}/versions`),
  })
  const releases = useQuery({
    queryKey: ['teach-releases', id],
    queryFn: () => apiJson<Release[]>(`/api/v1/offerings/${id}/releases`),
  })

  function openDialog(): void {
    setIdempotencyKey(crypto.randomUUID())
    setMessage('')
    dialog.current?.showModal()
  }

  async function release(): Promise<void> {
    if (!versionId || !availableFrom) {
      setMessage('Chọn phiên bản và giờ mở.')
      return
    }
    const due = fromLocal(dueAt)
    const accept = fromLocal(acceptUntil)
    try {
      await apiJson(`/api/v1/offerings/${id}/path-releases`, me.csrfToken, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          title,
          modules: [{
            moduleVersionId: versionId,
            availableFrom: fromLocal(availableFrom),
            ...(due ? { dueAt: due } : {}),
            ...(accept ? { acceptUntil: accept } : {}),
            latePolicy,
          }],
        }),
      })
      dialog.current?.close()
      setMessage('Đã giao bài.')
      await client.invalidateQueries({ queryKey: ['teach-releases', id] })
    } catch {
      setMessage('Không giao được. Đóng hộp và mở lại nếu cần khóa mới.')
    }
  }

  async function change(releaseId: string, revision: number, event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const due = fromLocal(String(data.get('dueAt') ?? ''))
    const accept = fromLocal(String(data.get('acceptUntil') ?? ''))
    await apiJson(`/api/v1/module-releases/${releaseId}/schedule`, me.csrfToken, {
      method: 'PATCH',
      headers: { 'if-match': `W/"${String(revision)}"` },
      body: JSON.stringify({
        ...(due ? { dueAt: due } : {}),
        ...(accept ? { acceptUntil: accept } : {}),
        reason: String(data.get('reason') ?? ''),
      }),
    })
    setMessage('Đã đổi lịch.')
    await client.invalidateQueries({ queryKey: ['teach-releases', id] })
  }

  return (
    <section className={styles.stack}>
      <h1>Giao bài {offering ? offering.title : ''}</h1>
      {releases.isLoading ? <p>Đang tải đợt giao.</p> : null}
      {releases.isError ? <p role="alert">Không tải được danh sách giao bài.</p> : null}
      {releases.data && releases.data.length === 0 ? <p>Chưa giao bài nào.</p> : null}
      <ul>
        {releases.data?.map((item) => (
          <li key={item.id}>
            <p>{item.title} · lịch {item.scheduleRevision} · {item.latePolicy === 'reject' ? 'Từ chối muộn' : 'Nhận muộn có ghi'}</p>
            <form className={styles.row} onSubmit={(event) => void change(item.id, item.scheduleRevision, event)}>
              <label>Hạn mới<input name="dueAt" type="datetime-local" /></label>
              <label>Nhận đến<input name="acceptUntil" type="datetime-local" /></label>
              <label>Lý do<input name="reason" required minLength={3} /></label>
              <button type="submit">Đổi lịch</button>
            </form>
          </li>
        ))}
      </ul>
      <button type="button" onClick={openDialog}>Giao bài mới</button>
      {message ? <p role="status">{message}</p> : null}
      <dialog ref={dialog} aria-labelledby="giao-title">
        <form className={styles.stack} onSubmit={(event) => { event.preventDefault(); void release() }}>
          <h2 id="giao-title">Giao một phiên bản</h2>
          <label>
            Tên đợt
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Module
            <select value={moduleId} onChange={(event) => { setModuleId(event.target.value); setVersionId('') }}>
              <option value="">Chọn module</option>
              {modules.data?.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label>
            Phiên bản
            <select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
              <option value="">Chọn phiên bản</option>
              {versions.data?.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.versionNo}</option>)}
            </select>
          </label>
          <label>Mở từ<input type="datetime-local" required value={availableFrom} onChange={(event) => setAvailableFrom(event.target.value)} /></label>
          <label>Hạn<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <label>Nhận đến<input type="datetime-local" value={acceptUntil} onChange={(event) => setAcceptUntil(event.target.value)} /></label>
          <label>
            Nộp muộn
            <select value={latePolicy} onChange={(event) => setLatePolicy(event.target.value as 'accept_marked' | 'reject')}>
              <option value="accept_marked">Nhận và ghi muộn</option>
              <option value="reject">Từ chối</option>
            </select>
          </label>
          <div className={styles.row}>
            <button type="submit">Giao</button>
            <button type="button" onClick={() => dialog.current?.close()}>Đóng</button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
