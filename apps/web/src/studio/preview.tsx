import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { readJson } from '../admin-api.ts'
import { RichView } from './rich-view.tsx'
import styles from './studio.module.css'

type Release = {
  title?: string
  items?: {
    type?: string
    title?: string
    body?: unknown
    url?: string
    assessment?: { questions?: { stem?: unknown; options?: { id: string; label: string }[]; hints?: string[] }[] }
  }[]
}

export default function StudioPreview() {
  const { moduleId } = useParams()
  const preview = useQuery({
    queryKey: ['preview', moduleId],
    enabled: Boolean(moduleId),
    queryFn: () => readJson<Release>(`/api/v1/modules/${moduleId}/draft/preview`),
  })
  return (
    <article className={styles.page}>
      <p className={styles.banner} role="status">Xem trước, không ghi tiến độ</p>
      <Link to={`/day/soan/${moduleId}`}>Về studio</Link>
      {preview.isLoading ? <p>Đang tải bản xem trước.</p> : null}
      {preview.isError ? <p role="alert">Không mở được bản xem trước.</p> : null}
      <h1>{preview.data?.title}</h1>
      {(preview.data?.items ?? []).map((item, index) => (
        <section key={index}>
          <h2>{item.title}</h2>
          {item.type === 'page' || item.type === 'assignment' ? <RichView doc={item.body} /> : null}
          {item.type === 'link' && item.url?.startsWith('https://') ? <a href={item.url}>{item.url}</a> : null}
          {item.type === 'link' && item.url && !item.url.startsWith('https://') ? <p>{item.url}</p> : null}
          {item.type === 'quiz'
            ? (item.assessment?.questions ?? []).map((question, questionIndex) => (
                <div key={questionIndex}>
                  <RichView doc={question.stem} />
                  <ul>{(question.options ?? []).map((option) => <li key={option.id}>{option.label}</li>)}</ul>
                  {(question.hints ?? []).map((hint) => <p key={hint}>Gợi ý: {hint}</p>)}
                </div>
              ))
            : null}
        </section>
      ))}
    </article>
  )
}
