import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { apiJson } from '../learn/http.ts'
import styles from './desk.module.css'

type Notice = { id: string; title: string; link: string; createdAt: string; readAt: string | null }

export function NotificationBell() {
  const unread = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => apiJson<Notice[]>('/api/v1/notifications?unread=true'),
  })
  const count = unread.data?.length ?? 0
  return (
    <Link to="/thong-bao" aria-label={count > 0 ? `Thông báo, ${count} chưa đọc` : 'Thông báo'}>
      Thông báo{count > 0 ? ` (${count})` : ''}
    </Link>
  )
}

export function Inbox() {
  const me = useRouteLoaderData('shell') as Me
  const client = useQueryClient()
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiJson<Notice[]>('/api/v1/notifications'),
  })
  if (notes.isLoading) return <p>Đang tải thông báo.</p>
  if (notes.isError) return <p role="alert">Không tải được thông báo. <button type="button" onClick={() => void notes.refetch()}>Thử lại</button></p>
  const items = notes.data ?? []
  return (
    <section className={styles.stack}>
      <h1>Thông báo</h1>
      {items.length === 0 ? <p>Chưa có thông báo.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link to={item.link}>{item.title}</Link>
            {item.readAt ? null : (
              <button
                type="button"
                onClick={() => {
                  void apiJson(`/api/v1/notifications/${item.id}/read`, me.csrfToken, { method: 'POST' }).then(async () => {
                    await client.invalidateQueries({ queryKey: ['notifications'] })
                    await client.invalidateQueries({ queryKey: ['notifications-unread'] })
                  })
                }}
              >
                Đánh dấu đã đọc
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
