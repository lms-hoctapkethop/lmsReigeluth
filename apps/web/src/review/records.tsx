import { useQuery } from '@tanstack/react-query'
import { useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { ApiError, apiJson } from '../learn/http.ts'
import styles from './desk.module.css'

type Decision = { id: string; decision: 'achieved' | 'not_yet'; decidedAt: string }
type Records = {
  activity: { completed: number; required: number; updatedAt: string | null }
  requirements: {
    requirement: { id: string; code791Stem: string; text: string }
    currentDecision: Decision | null
    evidence: { reviewId: string; publishedAt: string }[]
  }[]
  lastUpdatedAt: string
}

function when(value: string | null): string {
  if (!value) return 'chưa có'
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function LearnerRecord() {
  const { offeringId = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const records = useQuery({
    queryKey: ['records', me.userId, offeringId],
    queryFn: () => apiJson<Records>(`/api/v1/learners/${me.userId}/records?offeringId=${offeringId}`),
  })
  if (records.isLoading) return <p>Đang tải hồ sơ.</p>
  if (records.error instanceof ApiError && (records.error.status === 404 || records.error.status === 403)) {
    return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  }
  if (records.isError || !records.data) {
    return <p role="alert">Không tải được hồ sơ. <button type="button" onClick={() => void records.refetch()}>Thử lại</button></p>
  }
  const data = records.data
  return (
    <section className={styles.stack}>
      <h1>Hồ sơ học tập</h1>
      <section className={styles.panel} aria-labelledby="layer-activity">
        <h2 id="layer-activity">Hoạt động</h2>
        <p>{data.activity.completed}/{data.activity.required} mục đã hoàn thành</p>
        <p>cập nhật lúc {when(data.activity.updatedAt)}</p>
      </section>
      <section className={styles.panel} aria-labelledby="layer-decision">
        <h2 id="layer-decision">Kết luận của GV</h2>
        {data.requirements.length === 0 ? <p>Chưa có yêu cầu cần đạt trong lớp này.</p> : null}
        {data.requirements.map((row) => (
          <article key={row.requirement.id}>
            <h3>{row.requirement.code791Stem}</h3>
            <p>{row.requirement.text}</p>
            <p>{row.currentDecision ? (row.currentDecision.decision === 'achieved' ? 'Đạt' : 'Chưa đạt') : 'Chưa có kết luận'}</p>
            <p>cập nhật lúc {when(row.currentDecision?.decidedAt ?? null)}</p>
          </article>
        ))}
      </section>
      <section className={styles.panel} aria-labelledby="layer-evidence">
        <h2 id="layer-evidence">Minh chứng</h2>
        {data.requirements.every((row) => row.evidence.length === 0) ? <p>Chưa có nhận xét đã công bố.</p> : null}
        {data.requirements.flatMap((row) => row.evidence.map((item) => (
          <p key={item.reviewId}>{row.requirement.code791Stem}: nhận xét công bố lúc {when(item.publishedAt)}</p>
        )))}
      </section>
    </section>
  )
}
