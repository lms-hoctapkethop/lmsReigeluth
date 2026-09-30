import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { RichView } from '../studio/rich-view.tsx'
import { apiJson } from './http.ts'
import { QuizPanel } from './quiz.tsx'
import styles from './learn.module.css'

type Item = {
  id: string
  itemType: string
  title: string
  body: unknown
  url: string | null
  completionRule: string
  progress: { status: string; completedAt: string | null }
}

type Release = { releaseId: string; title: string; items: Item[] }

export function LearnRelease() {
  const { releaseId = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const client = useQueryClient()
  const release = useQuery({
    queryKey: ['learner-release', releaseId],
    queryFn: () => apiJson<Release>(`/api/v1/module-releases/${releaseId}`),
  })

  useEffect(() => {
    const items = release.data?.items.filter((item) => item.completionRule === 'view' && item.progress.status !== 'completed') ?? []
    if (items.length === 0 || me.activeContext.role !== 'student') return
    let cancelled = false
    void (async () => {
      for (const item of items) {
        await apiJson(`/api/v1/module-releases/${releaseId}/items/${item.id}/view`, me.csrfToken, { method: 'POST' })
      }
      if (!cancelled) await client.invalidateQueries({ queryKey: ['learner-release', releaseId] })
    })()
    return () => {
      cancelled = true
    }
  }, [release.data, releaseId, me.csrfToken, me.activeContext.role, client])

  async function selfMark(itemId: string): Promise<void> {
    await apiJson(`/api/v1/module-releases/${releaseId}/items/${itemId}/self-mark`, me.csrfToken, { method: 'POST' })
    await client.invalidateQueries({ queryKey: ['learner-release', releaseId] })
  }

  return (
    <section className={styles.stack}>
      {release.isLoading ? <p>Đang tải bài.</p> : null}
      {release.isError ? <p role="alert">Không mở được bài này.</p> : null}
      {release.data ? <h1>{release.data.title}</h1> : null}
      {release.data?.items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          {item.body ? <RichView doc={item.body} /> : null}
          {item.url ? <p><a href={item.url}>Mở liên kết</a></p> : null}
          {item.itemType === 'assignment' ? <p><Link to={`/hoc/bai/${releaseId}/muc/${item.id}`}>Làm nhiệm vụ</Link></p> : null}
          {item.itemType === 'quiz' && me.activeContext.role === 'student' ? <QuizPanel releaseId={releaseId} itemId={item.id} csrf={me.csrfToken} /> : null}
          {item.itemType === 'quiz' && item.progress.status === 'completed' ? <p>Đã hoàn thành</p> : null}
          {item.completionRule === 'view' && item.progress.status === 'completed' ? <p>Đã xem</p> : null}
          {item.completionRule === 'self_mark' && item.progress.status !== 'completed' ? (
            <button type="button" onClick={() => void selfMark(item.id)}>Tự đánh dấu</button>
          ) : null}
          {item.completionRule === 'self_mark' && item.progress.status === 'completed' ? <p>Đã tự đánh dấu</p> : null}
        </article>
      ))}
    </section>
  )
}
