import { useEffect, useRef, useState } from 'react'
import type { Me } from '@hcn/contracts'
import { readJson } from './admin-api.ts'
import styles from './curriculum.module.css'

type Kind = 'requirement' | 'kc' | 'edge' | 'misconception' | 'link'
type Item = {
  id: string
  code: string
  title: string
  extraction: string
  reviewStatus: string
  revision: string
  sourceDoc: string
  sourceLocator: string | null
  text: string
}
type Queue = { items: Item[]; counts: Record<Kind, number> }
type KcDetail = {
  name: string
  observableCriteria: string
  previous: { name: string; observableCriteria: string } | null
  edges: { id: string; fromCode: string; toCode: string; fromName: string; toName: string }[]
  links: { id: string; code: string }[]
}

const tabs: { kind: Kind; label: string }[] = [
  { kind: 'requirement', label: 'YCCĐ' },
  { kind: 'kc', label: 'KC' },
  { kind: 'edge', label: 'Cạnh' },
  { kind: 'misconception', label: 'Lỗi hiểu sai' },
  { kind: 'link', label: 'Liên kết' },
]

export function CurriculumHome({ me }: { me: Me }) {
  const [kind, setKind] = useState<Kind>('requirement')
  const [queue, setQueue] = useState<Queue | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [note, setNote] = useState('')
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [shortcuts, setShortcuts] = useState(true)
  const [detail, setDetail] = useState<KcDetail | null>(null)
  const [droppedEdges, setDroppedEdges] = useState<string[]>([])
  const [droppedLinks, setDroppedLinks] = useState<string[]>([])
  const errorRef = useRef<HTMLParagraphElement>(null)

  function load(nextKind = kind): void {
    setLoading(true)
    readJson<Queue>(`/api/v1/curriculum/review-queue?kind=${nextKind}`)
      .then((value) => {
        setQueue(value)
        setError('')
        setIndex(0)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Không tải được hàng đợi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(kind)
  }, [kind])

  const item = queue?.items[index]
  useEffect(() => {
    setText(item?.text ?? '')
    setNote('')
    setDroppedEdges([])
    setDroppedLinks([])
    if (kind !== 'kc' || !item) {
      setDetail(null)
      return
    }
    readJson<KcDetail>(`/api/v1/curriculum/kc-versions/${item.id}`).then(setDetail).catch(() => setDetail(null))
  }, [item?.id, kind])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!shortcuts) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (event.key === 'j') setIndex((value) => Math.min(value + 1, Math.max((queue?.items.length ?? 1) - 1, 0)))
      if (event.key === 'k') setIndex((value) => Math.max(value - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcuts, queue?.items.length])

  useEffect(() => {
    if (message.startsWith('Cạnh này')) errorRef.current?.focus()
  }, [message])

  async function review(path: string, body: unknown, revision?: string): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-csrf-token': me.csrfToken }
    if (revision) headers['if-match'] = revision
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) })
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string; details?: { path?: string; fromKc?: string; toKc?: string } } } | null
    if (!response.ok) {
      const cycle = payload?.error?.details?.path
      const codes = payload?.error?.details?.fromKc && payload.error.details.toKc ? `${payload.error.details.fromKc} → ${payload.error.details.toKc}` : ''
      setMessage(cycle ? `Cạnh này tạo thành vòng: ${cycle}` : codes ? `Cạnh này tạo thành vòng: ${codes}` : payload?.error?.message ?? 'Không duyệt được')
      return
    }
    setMessage('Đã ghi nhận kết quả duyệt.')
    load(kind)
  }

  return (
    <section className={styles.page}>
      <h1>Chuyên môn</h1>
      <p className={styles.badge}>Phím j và k chuyển mục trong hàng đợi.</p>
      <label>
        <input type="checkbox" checked={shortcuts} onChange={(event) => setShortcuts(event.target.checked)} /> Bật phím tắt j/k
      </label>
      <div className={styles.tabs} role="tablist" aria-label="Hàng đợi chuyên môn">
        {tabs.map((tab) => (
          <button
            key={tab.kind}
            className={styles.tab}
            type="button"
            role="tab"
            aria-selected={kind === tab.kind}
            onClick={() => {
              setMessage('')
              setKind(tab.kind)
            }}
          >
            {tab.label} ({queue?.counts[tab.kind] ?? 0})
          </button>
        ))}
      </div>
      <p
        ref={errorRef}
        role="status"
        aria-live="polite"
        tabIndex={message.startsWith('Cạnh này') ? -1 : undefined}
        className={message.startsWith('Cạnh này') ? styles.error : undefined}
      >
        {message}
      </p>
      {loading ? <p>Đang tải hàng đợi.</p> : null}
      {error ? <p>{error} <button type="button" className={styles.button} onClick={() => load(kind)}>Thử lại</button></p> : null}
      {!loading && queue?.items.length === 0 ? <p>Hàng đợi trống. Khi có mục cần duyệt, mục sẽ hiện ở đây.</p> : null}
      <div className={styles.layout}>
        <ul className={styles.list}>
          {queue?.items.map((entry, entryIndex) => (
            <li key={entry.id}>
              <button
                type="button"
                className={styles.item}
                aria-current={entryIndex === index ? 'true' : undefined}
                onClick={() => {
                  setMessage('')
                  setIndex(entryIndex)
                }}
              >
                {entry.code}
                {entry.reviewStatus === 'unverified' ? <span className={styles.badge}> Chưa đối chiếu</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {item ? (
          <div className={styles.card} role="tabpanel">
            {kind === 'requirement' ? (
              <div className={styles.split}>
                <div>
                  <h2>Văn bản và nguồn</h2>
                  <p>{item.text}</p>
                  <p>{item.sourceDoc}{item.sourceLocator ? ` · ${item.sourceLocator}` : ''}</p>
                </div>
                <label>
                  Sửa văn bản
                  <textarea aria-label="Sửa văn bản" value={text} onChange={(event) => setText(event.target.value)} />
                </label>
              </div>
            ) : null}
            {kind === 'kc' && detail?.previous ? (
              <div className={styles.split}>
                <div>
                  <h2>Version đang dùng</h2>
                  <p>{detail.previous.name}</p>
                  <p>{detail.previous.observableCriteria}</p>
                </div>
                <div>
                  <h2>Version đề xuất</h2>
                  <p>{detail.name}</p>
                  <p>{detail.observableCriteria}</p>
                </div>
              </div>
            ) : null}
            {kind === 'kc' && detail ? (
              <>
                <h2>Cạnh sẽ chép</h2>
                {detail.edges.length === 0 ? <p>Không có cạnh để chép.</p> : null}
                {detail.edges.map((edge) => (
                  <label key={edge.id}>
                    <input
                      type="checkbox"
                      checked={!droppedEdges.includes(edge.id)}
                      onChange={(event) => setDroppedEdges((current) => (event.target.checked ? current.filter((id) => id !== edge.id) : [...current, edge.id]))}
                    />
                    {edge.fromCode} {edge.fromName} → {edge.toCode} {edge.toName}
                  </label>
                ))}
                <h2>Liên kết sẽ chép</h2>
                {detail.links.map((link) => (
                  <label key={link.id}>
                    <input
                      type="checkbox"
                      checked={!droppedLinks.includes(link.id)}
                      onChange={(event) => setDroppedLinks((current) => (event.target.checked ? current.filter((id) => id !== link.id) : [...current, link.id]))}
                    />
                    {link.code}
                  </label>
                ))}
              </>
            ) : null}
            {kind === 'edge' ? <p>{item.text}</p> : null}
            {kind !== 'requirement' && kind !== 'kc' && kind !== 'edge' ? <p>{item.text}</p> : null}
            <label>
              Ghi chú
              <textarea aria-label="Ghi chú" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {message.startsWith('Cạnh này') ? <p className={styles.error}>{message}</p> : null}
            <div className={styles.actions}>
              {kind === 'requirement' ? (
                <button type="button" className={styles.button} onClick={() => review(`/api/v1/curriculum/requirements/${item.id}/review`, { decision: 'source_checked', note, correctedText: text }, item.revision)}>
                  Đối chiếu nguồn
                </button>
              ) : null}
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  if (kind === 'requirement') return review(`/api/v1/curriculum/requirements/${item.id}/review`, { decision: 'approved', note, correctedText: text }, item.revision)
                  if (kind === 'kc') return review(`/api/v1/curriculum/kc-versions/${item.id}/review`, { decision: 'approved', note, dropEdgeIds: droppedEdges, dropLinkIds: droppedLinks })
                  if (kind === 'edge') return review(`/api/v1/curriculum/kc-edges/${item.id}/review`, { decision: 'approved' })
                  if (kind === 'misconception') return review(`/api/v1/curriculum/misconceptions/${item.id}/review`, { decision: 'approved' })
                  return review(`/api/v1/curriculum/requirement-kc-links/${item.id}/review`, { decision: 'approved' })
                }}
              >
                Duyệt
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  if (kind === 'requirement') return review(`/api/v1/curriculum/requirements/${item.id}/review`, { decision: 'rejected', note }, item.revision)
                  if (kind === 'kc') return review(`/api/v1/curriculum/kc-versions/${item.id}/review`, { decision: 'rejected', note })
                  if (kind === 'edge') return review(`/api/v1/curriculum/kc-edges/${item.id}/review`, { decision: 'rejected' })
                  if (kind === 'misconception') return review(`/api/v1/curriculum/misconceptions/${item.id}/review`, { decision: 'rejected' })
                  return review(`/api/v1/curriculum/requirement-kc-links/${item.id}/review`, { decision: 'rejected' })
                }}
              >
                Loại
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
