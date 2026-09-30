import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ApiError, apiJson, retryUnlessDenied } from '../learn/http.ts'
import styles from './desk.module.css'

type Item = {
  submissionVersionId: string
  learnerName: string
  itemTitle: string
  versionNo: number
  submittedAt: string
  isLate: boolean
  status: string
}

function when(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function ReviewQueue() {
  const { offeringId = '' } = useParams()
  const queue = useQuery({
    queryKey: ['review-queue', offeringId],
    queryFn: () => apiJson<{ items: Item[] }>(`/api/v1/offerings/${offeringId}/review-queue`),
    retry: retryUnlessDenied,
  })
  if (queue.isLoading) return <p>Đang tải hàng chờ.</p>
  if (queue.error instanceof ApiError && (queue.error.status === 404 || queue.error.status === 403)) {
    return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  }
  if (queue.isError) {
    return (
      <p role="alert">
        Không tải được hàng chờ. <button type="button" onClick={() => void queue.refetch()}>Thử lại</button>
      </p>
    )
  }
  const items = queue.data?.items ?? []
  return (
    <section className={styles.stack}>
      <h1>Hàng chờ chấm</h1>
      <p className={styles.muted}>{items.length} bài chờ, {items.filter((item) => item.isLate).length} bài muộn.</p>
      {items.length === 0 ? <p>Chưa có bài chờ chấm. Khi học sinh nộp bài, bài sẽ xuất hiện ở đây.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.submissionVersionId}>
            <Link to={`/day/cham/bai/${item.submissionVersionId}`}>{item.itemTitle}</Link>
            {' · '}
            {item.learnerName}
            {' · phiên bản '}
            {item.versionNo}
            {' · '}
            {when(item.submittedAt)}
            {item.isLate ? ' · muộn' : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}
