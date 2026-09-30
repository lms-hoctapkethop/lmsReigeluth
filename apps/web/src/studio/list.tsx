import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { postJson, readJson } from '../admin-api.ts'
import styles from './studio.module.css'

type Course = { id: string; title: string; subjectCode: string; grade: number }
type Requirement = { id: string; code791Stem: string; text: string; reviewStatus: string }
type ModuleRow = { id: string; title: string; revision: number; latestVersionNo: number | null }

const statusLabel: Record<string, string> = {
  source_checked: 'đã đối chiếu, chưa duyệt',
  unverified: 'chưa đối chiếu',
  approved: 'đã duyệt',
}

export default function StudioList() {
  const me = useRouteLoaderData('shell') as Me
  const navigate = useNavigate()
  const courses = useQuery({ queryKey: ['author-courses'], queryFn: () => readJson<Course[]>('/api/v1/authoring/courses') })
  const [courseId, setCourseId] = useState('')
  const selected = courseId || courses.data?.[0]?.id || ''
  const catalog = useQuery({
    queryKey: ['author-catalog', selected],
    enabled: Boolean(selected),
    queryFn: () => readJson<{ requirements: Requirement[] }>(`/api/v1/authoring/catalog?courseId=${selected}`),
  })
  const modules = useQuery({
    queryKey: ['my-modules', selected],
    enabled: Boolean(selected),
    queryFn: () => readJson<ModuleRow[]>(`/api/v1/modules?courseId=${selected}`),
  })
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState('')

  async function createModule() {
    setError('')
    try {
      const created = await postJson<{ moduleId: string }>('/api/v1/modules', me.csrfToken, {
        courseId: selected,
        title,
        requirementIds: picked,
      })
      await navigate(`/day/soan/${created.moduleId}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được module')
    }
  }

  return (
    <section className={styles.page}>
      <h1>Soạn bài</h1>
      {courses.isLoading ? <p>Đang tải khóa học.</p> : null}
      {courses.isError ? <p role="alert">Không tải được danh sách khóa.</p> : null}
      <label>
        Khóa học
        <select className={styles.select} aria-label="Khóa học" value={selected} onChange={(event) => { setCourseId(event.target.value); setPicked([]) }}>
          {(courses.data ?? []).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </select>
      </label>
      <h2>Module của tôi</h2>
      {modules.isLoading ? <p>Đang tải module.</p> : null}
      {(modules.data ?? []).length === 0 && !modules.isLoading ? <p>Chưa có module trong khóa này.</p> : null}
      <ul>
        {(modules.data ?? []).map((row) => (
          <li key={row.id}><Link to={`/day/soan/${row.id}`}>{row.title}</Link>{row.latestVersionNo ? ` · phiên bản ${row.latestVersionNo}` : ''}</li>
        ))}
      </ul>
      <h2>Tạo module</h2>
      <label>
        Tên module
        <input className={styles.field} aria-label="Tên module" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <fieldset>
        <legend>Yêu cầu cần đạt</legend>
        {(catalog.data?.requirements ?? []).map((requirement) => {
          const approved = requirement.reviewStatus === 'approved'
          const note = statusLabel[requirement.reviewStatus] ?? requirement.reviewStatus
          return (
            <label key={requirement.id}>
              <input
                type="checkbox"
                disabled={!approved}
                checked={picked.includes(requirement.id)}
                onChange={(event) => {
                  setPicked((current) => event.target.checked ? [...current, requirement.id] : current.filter((id) => id !== requirement.id))
                }}
              />
              {requirement.code791Stem} {requirement.text} {approved ? '' : note}
            </label>
          )
        })}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <button className={styles.button} type="button" disabled={!selected || title.trim().length === 0} onClick={() => { void createModule() }}>
        Tạo module
      </button>
    </section>
  )
}
