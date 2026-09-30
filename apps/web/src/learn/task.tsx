import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { ApiError, apiJson, uploadFile } from './http.ts'
import styles from './learn.module.css'

type Rules = { types: Array<'text' | 'code' | 'rich'>; allowFiles: boolean; maxFiles: number }
type Item = { id: string; title: string; body: unknown; submission: Rules | null; rubric: { criteria: { title: string; meets: string; developing: string; notYet: string }[] } | null }
type Release = { releaseId: string; title: string; items: Item[] }
type Draft = { draftRevision: number; body: { body?: { type?: string; text?: string; language?: string; testCases?: TestCase[] }; fileIds?: string[] } | null }
type TestCase = { input: string; expected: string }
type Receipt = { versionNo: number; submittedAt: string; isLate: boolean; contentHash: string }
type Kind = 'text' | 'code' | 'rich'

const languages = ['python', 'sql', 'html', 'css', 'text'] as const

function clockLabel(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function LearnTask() {
  const { releaseId = '', itemId = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const idempotencyKey = useRef(crypto.randomUUID())
  const release = useQuery({
    queryKey: ['learner-release', releaseId],
    queryFn: () => apiJson<Release>(`/api/v1/module-releases/${releaseId}`),
  })
  const draft = useQuery({
    queryKey: ['submission-draft', releaseId, itemId],
    queryFn: () => apiJson<Draft>(`/api/v1/module-releases/${releaseId}/items/${itemId}/submission/draft`),
  })
  const item = release.data?.items.find((row) => row.id === itemId)
  const rules = item?.submission ?? { types: ['text'], allowFiles: false, maxFiles: 0 }
  const [kind, setKind] = useState<Kind>('text')
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<(typeof languages)[number]>('python')
  const [cases, setCases] = useState<TestCase[]>([{ input: '', expected: '' }])
  const [fileIds, setFileIds] = useState<string[]>([])
  const [files, setFiles] = useState<{ id: string; name: string; scan: string }[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!draft.data || hydrated.current) return
    hydrated.current = true
    setRevision(draft.data.draftRevision)
    if (dirty) return
    const body = draft.data.body?.body
    const nextKind = body?.type === 'code' || body?.type === 'rich' || body?.type === 'text' ? body.type : rules.types[0] ?? 'text'
    setKind(nextKind)
    setText(body?.text ?? '')
    if (body?.language && languages.includes(body.language as (typeof languages)[number])) {
      setLanguage(body.language as (typeof languages)[number])
    }
    if (body?.testCases && body.testCases.length > 0) setCases(body.testCases)
    setFileIds(draft.data.body?.fileIds ?? [])
  }, [draft.data, dirty, rules.types])

  useEffect(() => {
    if (!dirty) return
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])

  useEffect(() => {
    if (!dirty || receipt) return
    const timer = setInterval(() => {
      void save()
    }, 2000)
    return () => clearInterval(timer)
    async function save(): Promise<void> {
      if (!navigator.onLine) {
        setStatus('Chưa lưu, đang thử lại')
        return
      }
      const payload = {
        body: kind === 'code'
          ? { type: 'code' as const, language, text, testCases: cases }
          : kind === 'rich'
            ? { type: 'rich' as const, doc: { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] } }
            : { type: 'text' as const, text },
        ...(fileIds.length > 0 ? { fileIds } : {}),
      }
      try {
        const saved = await apiJson<{ draftRevision: number; savedAt: string }>(
          `/api/v1/module-releases/${releaseId}/items/${itemId}/submission/draft`,
          me.csrfToken,
          { method: 'PUT', headers: { 'if-match': `W/"${String(revision)}"` }, body: JSON.stringify(payload) },
        )
        setRevision(saved.draftRevision)
        setDirty(false)
        setStatus(`Đã lưu lúc ${clockLabel(saved.savedAt)}`)
        setNotice('')
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setNotice('Có bản mới hơn. Hãy tải lại trang.')
          setDirty(false)
          return
        }
        setStatus('Chưa lưu, đang thử lại')
      }
    }
  }, [dirty, receipt, kind, language, text, cases, fileIds, revision, releaseId, itemId, me.csrfToken])

  async function onUpload(file: File): Promise<void> {
    setProgress(0)
    setNotice('')
    try {
      const uploaded = await uploadFile(file, me.csrfToken, setProgress)
      setFileIds((current) => [...current, uploaded.id].slice(0, rules.maxFiles))
      setFiles((current) => [...current, { id: uploaded.id, name: uploaded.originalName, scan: uploaded.scanStatus }])
      setDirty(true)
      const started = Date.now()
      let scan = uploaded.scanStatus
      while (scan === 'pending' && Date.now() - started < 120_000) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        const meta = await apiJson<{ scanStatus: string }>(`/api/v1/files/${uploaded.id}/meta`)
        scan = meta.scanStatus
        setFiles((current) => current.map((item) => (item.id === uploaded.id ? { ...item, scan } : item)))
      }
    } catch (error) {
      setNotice(error instanceof ApiError ? error.code : 'Không tải được tệp')
    } finally {
      setProgress(null)
    }
  }

  async function submit(): Promise<void> {
    setNotice('')
    try {
      const result = await apiJson<Receipt>(
        `/api/v1/module-releases/${releaseId}/items/${itemId}/submissions`,
        me.csrfToken,
        {
          method: 'POST',
          headers: { 'idempotency-key': idempotencyKey.current },
          body: JSON.stringify({ draftRevision: revision }),
        },
      )
      setReceipt(result)
      setDirty(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 423) {
        setNotice('Tệp đang được quét.')
        return
      }
      if (error instanceof ApiError && error.status === 409) {
        setNotice('Có bản mới hơn. Hãy tải lại trang.')
        return
      }
      setNotice('Chưa nộp được.')
    }
  }

  const lines = text.split('\n')
  return (
    <section className={styles.stack}>
      {release.isLoading || draft.isLoading ? <p>Đang tải nhiệm vụ.</p> : null}
      {release.isError || draft.isError ? <p role="alert">Không mở được nhiệm vụ.</p> : null}
      {item ? <h1>{item.title}</h1> : null}
      {item?.rubric ? (
        <table>
          <caption>Tiêu chí</caption>
          <thead><tr><th>Tiêu chí</th><th>Đạt</th><th>Đang phát triển</th><th>Chưa đạt</th></tr></thead>
          <tbody>
            {item.rubric.criteria.map((row) => (
              <tr key={row.title}><td>{row.title}</td><td>{row.meets}</td><td>{row.developing}</td><td>{row.notYet}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {rules.types.length > 1 ? (
        <label>
          Loại bài
          <select value={kind} onChange={(event) => { setKind(event.target.value as Kind); setDirty(true) }}>
            {rules.types.map((type) => <option key={type} value={type}>{type === 'text' ? 'Văn bản' : type === 'code' ? 'Mã' : 'Văn bản có định dạng'}</option>)}
          </select>
        </label>
      ) : null}
      {kind === 'code' ? (
        <>
          <label>
            Ngôn ngữ
            <select value={language} onChange={(event) => { setLanguage(event.target.value as (typeof languages)[number]); setDirty(true) }}>
              {languages.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <div className={styles.editor}>
            <pre className={styles.gutter} aria-hidden="true">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</pre>
            <textarea aria-label="Mã nguồn" value={text} spellCheck={false} onChange={(event) => { setText(event.target.value); setDirty(true) }} />
          </div>
          <table>
            <caption>Ca thử</caption>
            <thead><tr><th>Đầu vào</th><th>Kỳ vọng</th></tr></thead>
            <tbody>
              {cases.map((row, index) => (
                <tr key={index}>
                  <td><input aria-label={`Đầu vào ${index + 1}`} value={row.input} onChange={(event) => {
                    const next = cases.slice()
                    const current = next[index]
                    if (!current) return
                    next[index] = { input: event.target.value, expected: current.expected }
                    setCases(next)
                    setDirty(true)
                  }} /></td>
                  <td><input aria-label={`Kỳ vọng ${index + 1}`} value={row.expected} onChange={(event) => {
                    const next = cases.slice()
                    const current = next[index]
                    if (!current) return
                    next[index] = { input: current.input, expected: event.target.value }
                    setCases(next)
                    setDirty(true)
                  }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => { setCases([...cases, { input: '', expected: '' }]); setDirty(true) }}>Thêm ca thử</button>
        </>
      ) : (
        <label>
          Bài làm
          <textarea value={text} onChange={(event) => { setText(event.target.value); setDirty(true) }} />
        </label>
      )}
      {rules.allowFiles ? (
        <label>
          Tệp đính kèm
          <input type="file" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void onUpload(file)
          }} />
        </label>
      ) : null}
      {progress !== null ? <progress aria-label="Tiến trình tải tệp" value={Math.round(progress * 100)} max={100} /> : null}
      <ul>
        {files.map((file) => <li key={file.id}>{file.name} · {file.scan === 'clean' ? 'Sạch' : file.scan === 'pending' ? 'Đang quét' : 'Không dùng được'}</li>)}
      </ul>
      <p role="status">{status}</p>
      {notice ? <p role="alert">{notice}</p> : null}
      {receipt ? (
        <section aria-label="Biên nhận">
          <h2>Biên nhận</h2>
          <p>Phiên bản {receipt.versionNo}</p>
          <p>Giờ máy chủ: {clockLabel(receipt.submittedAt)}</p>
          <p>{receipt.isLate ? 'Nộp muộn' : 'Đúng hạn'}</p>
          <p>Mã băm {receipt.contentHash.slice(0, 12)}</p>
        </section>
      ) : (
        <button type="button" disabled={dirty || revision < 1} onClick={() => void submit()}>Nộp bài</button>
      )}
    </section>
  )
}
