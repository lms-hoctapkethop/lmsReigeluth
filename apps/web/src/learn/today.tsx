import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { apiJson } from './http.ts'
import styles from './learn.module.css'

type TodayItem = {
  releaseId: string
  itemId: string
  offeringId: string
  offeringTitle: string
  title: string
  itemType: string
  dueAt: string | null
  status: string
}

const statusLabel: Record<string, string> = {
  not_started: 'Chưa làm',
  in_progress: 'Đang làm',
  changes_requested: 'Cần sửa',
}

function dueLabel(value: string | null): string {
  if (!value) return 'Không hạn'
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function LearnToday() {
  const today = useQuery({
    queryKey: ['learner-today'],
    queryFn: () => apiJson<{ items: TodayItem[]; newFeedback: number }>('/api/v1/me/today'),
  })
  return (
    <section className={styles.stack}>
      <h1>Việc cần làm</h1>
      {today.isLoading ? <p>Đang tải việc cần làm.</p> : null}
      {today.isError ? <p role="alert">Không tải được việc cần làm.</p> : null}
      {today.data && today.data.items.length === 0 ? <p>Hôm nay chưa có việc đến hạn.</p> : null}
      {today.data && today.data.newFeedback > 0 ? <p>Có {today.data.newFeedback} nhận xét mới.</p> : null}
      <ul>
        {today.data?.items.map((item) => (
          <li key={`${item.releaseId}:${item.itemId}`}>
            <Link to={item.itemType === 'assignment' ? `/hoc/bai/${item.releaseId}/muc/${item.itemId}` : `/hoc/bai/${item.releaseId}`}>
              {item.title}
            </Link>
            {' · '}
            <Link to={`/hoc/lop/${item.offeringId}`}>{item.offeringTitle}</Link>
            {' · hạn '}
            {dueLabel(item.dueAt)}
            {' · '}
            {statusLabel[item.status] ?? item.status}
          </li>
        ))}
      </ul>
    </section>
  )
}
