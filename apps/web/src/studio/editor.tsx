import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { readJson } from '../admin-api.ts'
import styles from './studio.module.css'

type Rich = { format: 'hcn-rich/1'; blocks: [{ type: 'paragraph'; children: [{ text: string }] }] }
type Criterion = { title: string; kcVersionId: string | null; levels: { meets: string; developing: string; notYet: string } }
type Rubric = { title: string; criteria: Criterion[] }
type Question = {
  clientKey: string
  qtype: 'single_choice'
  stem: Rich
  options: { id: string; label: string }[]
  answerKey: { option: string }
  rationale?: Rich
  kcRequired: string[]
  kcObservable: string[]
  bloomTarget: number
  hints: string[]
  optionMisconceptions?: Record<string, string>
}
type Assessment = {
  purpose: 'diagnostic' | 'practice' | 'exit_ticket' | 'self_assessment' | 'summative'
  maxAttempts: number | null
  showFeedback: 'after_submit'
  hintsEnabled: boolean
  shuffleOptions: boolean
  questions: Question[]
}
type Item =
  | { clientKey: string; type: 'header'; title: string; indent: 0; completion: 'none' }
  | { clientKey: string; type: 'page'; title: string; indent: 0; completion: 'view'; body: Rich }
  | { clientKey: string; type: 'link'; title: string; indent: 0; completion: 'view'; url: string }
  | { clientKey: string; type: 'assignment'; title: string; indent: 0; completion: 'submit'; body: Rich; requirementIds: string[]; rubric?: Rubric }
  | { clientKey: string; type: 'quiz'; title: string; indent: 0; completion: 'submit'; assessment: Assessment }
type Draft = { schema: 'module-draft/1'; title: string; requirementIds: string[]; items: Item[] }
type Catalog = {
  requirements: { id: string; code791Stem: string; text: string }[]
  kcs: { id: string; kcId: string; code: string; name: string }[]
  misconceptions: { id: string; code: string; kcId: string; description: string }[]
  links: { requirementId: string; kcVersionId: string }[]
}
type Warning = { code: string; level: 'block' | 'caution' | 'info'; target: string; message: string }
type Report = {
  rows: { requirementId: string; choiceObservations: number; productObservations: number }[]
  warnings: Warning[]
  blocking: boolean
  superseded: { kcVersionId: string; replacementVersionId: string; replacementVersionNo: number }[]
}

function paragraph(text: string): Rich {
  return { format: 'hcn-rich/1', blocks: [{ type: 'paragraph', children: [{ text }] }] }
}
function readParagraph(doc: Rich | undefined): string {
  return doc?.blocks[0]?.children[0]?.text ?? ''
}
function key(): string {
  return crypto.randomUUID()
}
function question(): Question {
  return {
    clientKey: key(),
    qtype: 'single_choice',
    stem: paragraph(''),
    options: [{ id: 'a', label: 'Phương án A' }, { id: 'b', label: 'Phương án B' }],
    answerKey: { option: 'a' },
    kcRequired: [],
    kcObservable: [],
    bloomTarget: 2,
    hints: [],
  }
}
function criterion(): Criterion {
  return { title: '', kcVersionId: null, levels: { meets: 'Đạt yêu cầu', developing: 'Đang phát triển', notYet: 'Chưa thể hiện' } }
}

function OutlineRow({ id, title, onSelect, onUp, onDown }: { id: string; title: string; onSelect: () => void; onUp: () => void; onDown: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }
  return (
    <div ref={setNodeRef} style={style} className={styles.outlineItem}>
      <button className={styles.quiet} type="button" aria-label={`Kéo ${title}`} {...attributes} {...listeners}>Kéo</button>
      <button className={styles.quiet} type="button" onClick={onSelect}>{title}</button>
      <button className={styles.quiet} type="button" onClick={onUp}>Lên</button>
      <button className={styles.quiet} type="button" onClick={onDown}>Xuống</button>
    </div>
  )
}

export default function StudioEditor() {
  const me = useRouteLoaderData('shell') as Me
  const { moduleId = '' } = useParams()
  const loaded = useQuery({
    queryKey: ['draft', moduleId],
    queryFn: () => readJson<{ courseId: string; revision: number; payload: Draft; latestVersionNo: number | null }>(`/api/v1/modules/${moduleId}/draft`),
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [revision, setRevision] = useState(1)
  const [selected, setSelected] = useState(0)
  const [pane, setPane] = useState<'outline' | 'edit' | 'side'>('edit')
  const [status, setStatus] = useState('Chưa có thay đổi.')
  const [conflict, setConflict] = useState(false)
  const [localCopy, setLocalCopy] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [versionNo, setVersionNo] = useState<number | null>(null)
  const idempotencyKey = useRef('')
  const conflictRef = useRef(false)
  const dirty = useRef(false)
  const draftRef = useRef<Draft | null>(null)
  const revisionRef = useRef(1)
  const saving = useRef(false)
  const courseId = loaded.data?.courseId ?? ''
  const catalog = useQuery({
    queryKey: ['author-catalog', courseId],
    enabled: Boolean(courseId),
    queryFn: () => readJson<Catalog>(`/api/v1/authoring/catalog?courseId=${courseId}`),
  })
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (!loaded.data || draft) return
    setDraft(loaded.data.payload)
    draftRef.current = loaded.data.payload
    setRevision(loaded.data.revision)
    revisionRef.current = loaded.data.revision
    setVersionNo(loaded.data.latestVersionNo)
  }, [loaded.data, draft])

  useEffect(() => {
    if (!loaded.data) return
    void readJson<Report>(`/api/v1/modules/${moduleId}/draft/validate`).then(setReport).catch(() => setReport(null))
  }, [loaded.data, moduleId])

  async function flush() {
    const current = draftRef.current
    if (!current || !dirty.current || saving.current || conflictRef.current) return
    saving.current = true
    const response = await fetch(`/api/v1/modules/${moduleId}/draft`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
        'if-match': `W/"${revisionRef.current}"`,
      },
      body: JSON.stringify(current),
      keepalive: true,
    })
    saving.current = false
    if (response.status === 409) {
      dirty.current = false
      conflictRef.current = true
      setLocalCopy(JSON.stringify(current, null, 2))
      setConflict(true)
      return
    }
    if (!response.ok) {
      setStatus('Chưa lưu được. Hãy điền đủ KC và nội dung.')
      return
    }
    const body = await response.json() as { revision: number }
    revisionRef.current = body.revision
    setRevision(body.revision)
    dirty.current = false
    setStatus('Đã lưu')
    const next = await readJson<Report>(`/api/v1/modules/${moduleId}/draft/validate`).catch(() => null)
    if (next) setReport(next)
  }

  useEffect(() => {
    if (!draft || !dirty.current) return undefined
    const timer = window.setTimeout(() => { void flush() }, 2000)
    return () => window.clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    const leave = () => { void flush() }
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave() })
    return () => window.removeEventListener('pagehide', leave)
  }, [moduleId])

  function update(next: Draft) {
    draftRef.current = next
    dirty.current = true
    setDraft(next)
    setStatus('Sẽ lưu sau 2 giây.')
  }

  function moveFrom(index: number, delta: number) {
    const current = draftRef.current
    if (!current) return
    const target = index + delta
    if (target < 0 || target >= current.items.length) return
    update({ ...current, items: arrayMove(current.items, index, target) })
    setSelected(target)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      moveFrom(selected, event.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function add(item: Item) {
    if (!draft) return
    update({ ...draft, items: [...draft.items, item] })
    setSelected(draft.items.length)
  }

  function patchItem(index: number, item: Item) {
    if (!draft) return
    const items = draft.items.map((current, itemIndex) => itemIndex === index ? item : current)
    update({ ...draft, items })
  }

  function onDragEnd(event: DragEndEvent) {
    if (!draft || !event.over || event.active.id === event.over.id) return
    const from = draft.items.findIndex((item) => item.clientKey === event.active.id)
    const to = draft.items.findIndex((item) => item.clientKey === event.over?.id)
    if (from < 0 || to < 0) return
    update({ ...draft, items: arrayMove(draft.items, from, to) })
    setSelected(to)
  }

  function replaceKc(from: string, to: string) {
    if (!draft) return
    const next = structuredClone(draft)
    for (const item of next.items) {
      if (item.type === 'assignment' && item.rubric) {
        for (const row of item.rubric.criteria) if (row.kcVersionId === from) row.kcVersionId = to
      }
      if (item.type === 'quiz') {
        for (const row of item.assessment.questions) {
          row.kcObservable = row.kcObservable.map((id) => id === from ? to : id)
          row.kcRequired = row.kcRequired.map((id) => id === from ? to : id)
        }
      }
    }
    update(next)
  }

  async function confirmPublish() {
    await flush()
    const cautions = (report?.warnings ?? []).filter((warning) => warning.level === 'caution')
    const response = await fetch(`/api/v1/modules/${moduleId}/versions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': me.csrfToken,
        'idempotency-key': idempotencyKey.current,
      },
      body: JSON.stringify({
        expectedRevision: revisionRef.current,
        acknowledgements: cautions.map((warning) => ({
          code: warning.code,
          target: warning.target,
          reason: reasons[`${warning.code}:${warning.target}`] ?? '',
        })),
      }),
    })
    const body = await response.json().catch(() => null) as { versionNo?: number; error?: { message?: string } } | null
    if (!response.ok) {
      setStatus(body?.error?.message ?? 'Chưa phát hành được')
      return
    }
    setVersionNo(body?.versionNo ?? null)
    setPublishOpen(false)
    setStatus('Đã phát hành')
  }

  if (loaded.isLoading || !draft) return <p>Đang tải bản nháp.</p>
  if (loaded.isError) return <p role="alert">Không mở được bản nháp.</p>
  const item = draft.items[selected]
  const cautions = (report?.warnings ?? []).filter((warning) => warning.level === 'caution')
  const kcsOf = (requirementId: string) => new Set((catalog.data?.links ?? []).filter((link) => link.requirementId === requirementId).map((link) => link.kcVersionId))

  return (
    <section className={styles.page}>
      <h1>{draft.title}</h1>
      <p role="status">{status} · revision {revision}</p>
      {versionNo ? <p>Phiên bản {versionNo}</p> : null}
      <p><Link to={`/day/soan/${moduleId}/xem-truoc`}>Xem trước</Link></p>
      <div className={styles.tabs} role="tablist">
        <button className={styles.quiet} type="button" role="tab" aria-selected={pane === 'outline'} onClick={() => setPane('outline')}>Dàn mục</button>
        <button className={styles.quiet} type="button" role="tab" aria-selected={pane === 'edit'} onClick={() => setPane('edit')}>Soạn</button>
        <button className={styles.quiet} type="button" role="tab" aria-selected={pane === 'side'} onClick={() => setPane('side')}>Độ phủ</button>
      </div>
      <div className={styles.layout}>
        <div className={`${styles.pane} ${pane === 'outline' ? styles.active : ''}`}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.items.map((row) => row.clientKey)} strategy={verticalListSortingStrategy}>
              {draft.items.map((row, index) => (
                <OutlineRow
                  key={row.clientKey}
                  id={row.clientKey}
                  title={row.title || row.type}
                  onSelect={() => setSelected(index)}
                  onUp={() => moveFrom(index, -1)}
                  onDown={() => moveFrom(index, 1)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button className={styles.quiet} type="button" onClick={() => add({ clientKey: key(), type: 'page', title: 'Trang mới', indent: 0, completion: 'view', body: paragraph('') })}>Thêm trang</button>
          <button className={styles.quiet} type="button" onClick={() => add({ clientKey: key(), type: 'quiz', title: 'Quiz', indent: 0, completion: 'submit', assessment: { purpose: 'practice', maxAttempts: null, showFeedback: 'after_submit', hintsEnabled: true, shuffleOptions: false, questions: [] } })}>Thêm quiz</button>
          <button className={styles.quiet} type="button" onClick={() => add({ clientKey: key(), type: 'assignment', title: 'Nhiệm vụ', indent: 0, completion: 'submit', body: paragraph(''), requirementIds: draft.requirementIds })}>Thêm nhiệm vụ</button>
          <button className={styles.quiet} type="button" onClick={() => add({ clientKey: key(), type: 'header', title: 'Mục', indent: 0, completion: 'none' })}>Thêm đề mục</button>
          <button className={styles.quiet} type="button" onClick={() => add({ clientKey: key(), type: 'link', title: 'Liên kết', indent: 0, completion: 'view', url: 'https://' })}>Thêm liên kết</button>
        </div>
        <div className={`${styles.pane} ${pane === 'edit' ? styles.active : ''}`}>
          {!item ? <p>Chọn một mục hoặc thêm mục mới.</p> : null}
          {item ? (
            <label>
              Tiêu đề mục
              <input className={styles.field} aria-label={item.type === 'assignment' ? 'Tiêu đề nhiệm vụ' : 'Tiêu đề mục'} value={item.title} onChange={(event) => patchItem(selected, { ...item, title: event.target.value })} />
            </label>
          ) : null}
          {item?.type === 'page' || item?.type === 'assignment' ? (
            <label>
              {item.type === 'page' ? 'Nội dung trang' : 'Đề bài'}
              <textarea className={styles.area} aria-label={item.type === 'page' ? 'Nội dung trang' : 'Đề bài'} value={readParagraph(item.body)} onChange={(event) => patchItem(selected, { ...item, body: paragraph(event.target.value) })} />
            </label>
          ) : null}
          {item?.type === 'link' ? (
            <label>
              URL
              <input className={styles.field} aria-label="URL" value={item.url} onChange={(event) => patchItem(selected, { ...item, url: event.target.value })} />
            </label>
          ) : null}
          {item?.type === 'quiz' ? (
            <div className={styles.stack}>
              <label>
                Mục đích
                <select className={styles.select} aria-label="Mục đích" value={item.assessment.purpose} onChange={(event) => {
                  const purpose = event.target.value as Assessment['purpose']
                  patchItem(selected, { ...item, assessment: { ...item.assessment, purpose, hintsEnabled: purpose === 'practice', maxAttempts: purpose === 'practice' ? null : 1 } })
                }}>
                  <option value="practice">practice</option>
                  <option value="diagnostic">diagnostic</option>
                  <option value="exit_ticket">exit_ticket</option>
                  <option value="self_assessment">self_assessment</option>
                  <option value="summative">summative</option>
                </select>
              </label>
              {item.assessment.questions.map((row, index) => {
                const observable = row.kcObservable[0] ?? ''
                const kc = catalog.data?.kcs.find((entry) => entry.id === observable)
                const mistakes = (catalog.data?.misconceptions ?? []).filter((entry) => entry.kcId === kc?.kcId)
                return (
                  <fieldset key={row.clientKey}>
                    <legend>Câu {index + 1}</legend>
                    <label>Đề bài<textarea className={styles.area} aria-label="Đề bài" value={readParagraph(row.stem)} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, stem: paragraph(event.target.value) } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>Phương án A<input className={styles.field} aria-label="Phương án A" value={row.options[0]?.label ?? ''} onChange={(event) => {
                      const options = [{ id: 'a', label: event.target.value }, row.options[1] ?? { id: 'b', label: '' }]
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, options } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>Phương án B<input className={styles.field} aria-label="Phương án B" value={row.options[1]?.label ?? ''} onChange={(event) => {
                      const options = [row.options[0] ?? { id: 'a', label: '' }, { id: 'b', label: event.target.value }]
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, options } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>Đáp án<input className={styles.field} aria-label="Đáp án" value={row.answerKey.option} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, answerKey: { option: event.target.value } } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>KC quan sát<select className={styles.select} aria-label="KC quan sát" value={observable} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, kcObservable: event.target.value ? [event.target.value] : [] } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }}>
                      <option value="">Chọn KC đã duyệt</option>
                      {(catalog.data?.kcs ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.code}</option>)}
                    </select></label>
                    <label>KC required<select className={styles.select} aria-label="KC required" value={row.kcRequired[0] ?? ''} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, kcRequired: event.target.value ? [event.target.value] : [] } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }}>
                      <option value="">Không bắt buộc</option>
                      {(catalog.data?.kcs ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.code}</option>)}
                    </select></label>
                    <label>Bloom<input className={styles.field} aria-label="Bloom" type="number" min={1} max={6} value={row.bloomTarget} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, bloomTarget: Number(event.target.value) } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>Gợi ý<input className={styles.field} aria-label="Gợi ý" value={row.hints[0] ?? ''} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, hints: event.target.value ? [event.target.value] : [] } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                    <label>Lỗi hiểu sai phương án B<select className={styles.select} aria-label="Lỗi hiểu sai phương án B" value={row.optionMisconceptions?.b ?? ''} onChange={(event) => {
                      const optionMisconceptions = event.target.value ? { b: event.target.value } : undefined
                      const questions = item.assessment.questions.map((current, currentIndex) => {
                        if (currentIndex !== index) return current
                        const next = { ...current }
                        if (optionMisconceptions) next.optionMisconceptions = optionMisconceptions
                        else delete next.optionMisconceptions
                        return next
                      })
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }}>
                      <option value="">Chưa gắn</option>
                      {mistakes.map((entry) => <option key={entry.id} value={entry.id}>{entry.code}</option>)}
                    </select></label>
                    <label>Giải thích<textarea className={styles.area} aria-label="Giải thích" value={readParagraph(row.rationale)} onChange={(event) => {
                      const questions = item.assessment.questions.map((current, currentIndex) => currentIndex === index ? { ...current, ...(event.target.value ? { rationale: paragraph(event.target.value) } : {}) } : current)
                      patchItem(selected, { ...item, assessment: { ...item.assessment, questions } })
                    }} /></label>
                  </fieldset>
                )
              })}
              <button className={styles.quiet} type="button" onClick={() => patchItem(selected, { ...item, assessment: { ...item.assessment, questions: [...item.assessment.questions, question()] } })}>Thêm câu</button>
            </div>
          ) : null}
          {item?.type === 'assignment' ? (
            <div className={styles.stack}>
              <p>Rubric</p>
              {(item.rubric?.criteria ?? []).map((row, index) => (
                <fieldset key={index}>
                  <legend>Tiêu chí {index + 1}</legend>
                  <label>Tiêu đề tiêu chí<input className={styles.field} aria-label="Tiêu đề tiêu chí" value={row.title} onChange={(event) => {
                    const criteria = (item.rubric?.criteria ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, title: event.target.value } : current)
                    patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
                  }} /></label>
                  <label>KC tiêu chí<select className={styles.select} aria-label="KC tiêu chí" value={row.kcVersionId ?? ''} onChange={(event) => {
                    const criteria = (item.rubric?.criteria ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, kcVersionId: event.target.value || null } : current)
                    patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
                  }}>
                    <option value="">Không gắn KC</option>
                    {(catalog.data?.kcs ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.code}</option>)}
                  </select></label>
                  <label>Mức đạt<input className={styles.field} aria-label="Mức đạt" value={row.levels.meets} onChange={(event) => {
                    const criteria = (item.rubric?.criteria ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, levels: { ...current.levels, meets: event.target.value } } : current)
                    patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
                  }} /></label>
                  <label>Đang phát triển<input className={styles.field} aria-label="Đang phát triển" value={row.levels.developing} onChange={(event) => {
                    const criteria = (item.rubric?.criteria ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, levels: { ...current.levels, developing: event.target.value } } : current)
                    patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
                  }} /></label>
                  <label>Chưa thể hiện<input className={styles.field} aria-label="Chưa thể hiện" value={row.levels.notYet} onChange={(event) => {
                    const criteria = (item.rubric?.criteria ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, levels: { ...current.levels, notYet: event.target.value } } : current)
                    patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
                  }} /></label>
                </fieldset>
              ))}
              <button className={styles.quiet} type="button" onClick={() => {
                const criteria = [...(item.rubric?.criteria ?? []), criterion()]
                patchItem(selected, { ...item, rubric: { title: item.rubric?.title ?? 'Rubric', criteria } })
              }}>Thêm tiêu chí</button>
            </div>
          ) : null}
        </div>
        <div className={`${styles.pane} ${pane === 'side' ? styles.active : ''}`}>
          <h2>Độ phủ</h2>
          <div role="region" aria-label="Cảnh báo độ phủ">
            {(report?.warnings ?? []).map((warning) => <p className={styles.warn} key={`${warning.code}:${warning.target}`}>{warning.code} {warning.message}</p>)}
          </div>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th>YCCĐ</th>
                {draft.items.map((row) => <th key={row.clientKey}>{row.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {draft.requirementIds.map((requirementId) => {
                const linked = kcsOf(requirementId)
                const code = catalog.data?.requirements.find((requirement) => requirement.id === requirementId)?.code791Stem ?? requirementId
                return (
                  <tr key={requirementId}>
                    <th>{code}</th>
                    {draft.items.map((row) => {
                      let count = 0
                      if (row.type === 'quiz') count = row.assessment.questions.filter((entry) => entry.kcObservable.some((id) => linked.has(id))).length
                      if (row.type === 'assignment') count = (row.rubric?.criteria ?? []).filter((entry) => entry.kcVersionId && linked.has(entry.kcVersionId)).length
                      return <td key={row.clientKey}>{count}</td>
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(report?.superseded ?? []).map((row) => (
            <button key={row.kcVersionId} className={styles.quiet} type="button" onClick={() => replaceKc(row.kcVersionId, row.replacementVersionId)}>
              Cập nhật lên version mới ({row.replacementVersionNo})
            </button>
          ))}
          <button
            className={styles.button}
            type="button"
            disabled={report?.blocking !== false}
            onClick={() => {
              if (!idempotencyKey.current || !publishOpen) idempotencyKey.current = crypto.randomUUID()
              setPublishOpen(true)
            }}
          >
            Phát hành phiên bản
          </button>
        </div>
      </div>
      {publishOpen ? (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="publish-title">
          <h2 id="publish-title">Phát hành phiên bản</h2>
          {cautions.length === 0 ? <p>Không có cảnh báo caution.</p> : null}
          {cautions.map((warning) => (
            <label key={`${warning.code}:${warning.target}`}>
              Lý do {warning.code} {warning.target}
              <textarea
                className={styles.area}
                aria-label={`Lý do ${warning.code} ${warning.target}`}
                value={reasons[`${warning.code}:${warning.target}`] ?? ''}
                onChange={(event) => setReasons((current) => ({ ...current, [`${warning.code}:${warning.target}`]: event.target.value }))}
              />
            </label>
          ))}
          <button className={styles.button} type="button" onClick={() => { void confirmPublish() }}>Xác nhận phát hành</button>
          <button className={styles.quiet} type="button" onClick={() => setPublishOpen(false)}>Đóng</button>
        </div>
      ) : null}
      {conflict ? (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="conflict-title">
          <h2 id="conflict-title">Có người vừa sửa</h2>
          <p>Bản trên máy chủ mới hơn. Bạn có thể tải bản đó hoặc sao chép thay đổi của mình. Không ghi đè im lặng.</p>
          <textarea className={styles.area} readOnly value={localCopy} aria-label="Thay đổi của tôi" />
          <button className={styles.button} type="button" onClick={() => { window.location.reload() }}>Tải bản mới</button>
          <button className={styles.quiet} type="button" onClick={() => { void navigator.clipboard.writeText(localCopy) }}>Sao chép thay đổi của tôi</button>
        </div>
      ) : null}
    </section>
  )
}
