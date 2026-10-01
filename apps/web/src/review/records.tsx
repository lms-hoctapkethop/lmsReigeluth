import { useQuery } from '@tanstack/react-query'
import { useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { ApiError, apiJson, retryUnlessDenied } from '../learn/http.ts'
import styles from './desk.module.css'

type NeedStatus = 'insufficient' | 'needs_support' | 'developing' | 'strong'
type NeedItem = { kcVersionId: string; kcName: string; status: NeedStatus; label?: string }
type Decision = { id: string; decision: 'achieved' | 'not_yet'; decidedAt: string }

const needLabel: Record<NeedStatus, string> = {
  insufficient: 'Chưa đủ bằng chứng',
  needs_support: 'Cần hỗ trợ',
  developing: 'Đang phát triển',
  strong: 'Có bằng chứng tốt',
}
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
    retry: retryUnlessDenied,
  })
  const needs = useQuery({
    queryKey: ['needs', me.userId, offeringId],
    queryFn: () => apiJson<NeedItem[]>(`/api/v1/learners/${me.userId}/needs?offeringId=${offeringId}`),
    retry: retryUnlessDenied,
    enabled: Boolean(records.data),
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
      <section className={styles.panel} aria-labelledby="layer-needs">
        <h2 id="layer-needs">Nhu cầu</h2>
        {needs.isLoading ? <p>Đang tải nhu cầu.</p> : null}
        {needs.isError ? <p role="alert">Không tải được nhu cầu. <button type="button" onClick={() => void needs.refetch()}>Thử lại</button></p> : null}
        {needs.data && needs.data.length === 0 ? <p>Chưa có ước lượng.</p> : null}
        {needs.data?.map((item) => (
          <article key={item.kcVersionId}>
            <h3>{item.kcName}</h3>
            <p>{item.label ?? needLabel[item.status]}</p>
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
