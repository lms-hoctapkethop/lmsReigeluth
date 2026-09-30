import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { ApiError, apiJson, retryUnlessDenied } from '../learn/http.ts'
import styles from './desk.module.css'

type Child = { learnerId: string; name: string; className: string }
type Overview = {
  learnerId: string
  offerings: {
    offeringId: string
    title: string
    activity: { completed: number; required: number }
    achievedRequirements: number
    totalRequirements: number
    publishedFeedback: { id: string; comment: string | null; publishedAt: string }[]
    upcoming: { title: string; dueAt: string }[]
  }[]
  supports: { id: string; content: string; status: string; createdAt: string }[]
}

export function GuardianHome() {
  const children = useQuery({
    queryKey: ['my-children'],
    queryFn: () => apiJson<Child[]>('/api/v1/me/children'),
  })
  return (
    <section className={styles.stack}>
      <h1>Con của tôi</h1>
      {children.isLoading ? <p>Đang tải danh sách con.</p> : null}
      {children.isError ? <p role="alert">Không tải được danh sách. <button type="button" onClick={() => void children.refetch()}>Thử lại</button></p> : null}
      {children.data && children.data.length === 0 ? <p>Chưa có liên kết phụ huynh đã xác minh.</p> : null}
      <ul>
        {children.data?.map((child) => (
          <li key={child.learnerId}>
            <Link to={`/phu-huynh/con/${child.learnerId}`}>{child.name}</Link>
            {child.className ? ` · lớp ${child.className}` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function GuardianChild() {
  const { learnerId = '' } = useParams()
  const me = useRouteLoaderData('shell') as Me
  const client = useQueryClient()
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const overview = useQuery({
    queryKey: ['child-overview', learnerId],
    queryFn: () => apiJson<Overview>(`/api/v1/children/${learnerId}/overview`),
    retry: retryUnlessDenied,
  })
  if (overview.isLoading) return <p>Đang tải tổng quan.</p>
  if (overview.error instanceof ApiError && (overview.error.status === 404 || overview.error.status === 403)) {
    return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  }
  if (overview.isError || !overview.data) {
    return <p role="alert">Không tải được tổng quan. <button type="button" onClick={() => void overview.refetch()}>Thử lại</button></p>
  }
  const data = overview.data
  return (
    <section className={styles.stack}>
      <h1>Tổng quan</h1>
      <p><Link to="/phu-huynh">Danh sách con</Link></p>
      {data.offerings.length === 0 ? <p>Con chưa có lớp đang học.</p> : null}
      {data.offerings.map((offering) => (
        <article key={offering.offeringId} className={styles.panel}>
          <h2>{offering.title}</h2>
          <p>Hoạt động: {offering.activity.completed}/{offering.activity.required}</p>
          <p>Yêu cầu đã được xác nhận: {offering.achievedRequirements}/{offering.totalRequirements}</p>
          <h3>Phản hồi đã công bố</h3>
          {offering.publishedFeedback.length === 0 ? <p>Chưa có phản hồi đã công bố.</p> : null}
          {offering.publishedFeedback.map((item) => <p key={item.id}>{item.comment ?? 'Đã công bố nhận xét'}</p>)}
          <h3>Việc sắp tới</h3>
          {offering.upcoming.length === 0 ? <p>Chưa có việc sắp đến hạn.</p> : null}
          <ul>{offering.upcoming.map((item) => <li key={item.title}>{item.title}</li>)}</ul>
        </article>
      ))}
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          const offeringId = data.offerings[0]?.offeringId
          void apiJson('/api/v1/family-supports', me.csrfToken, {
            method: 'POST',
            headers: { 'idempotency-key': crypto.randomUUID() },
            body: JSON.stringify({ learnerId, content, ...(offeringId ? { offeringId } : {}) }),
          }).then(async () => {
            setContent('')
            setMessage('Đã ghi nhận đồng hành.')
            await client.invalidateQueries({ queryKey: ['child-overview', learnerId] })
          }).catch(() => setError('Chưa ghi được. Hãy viết ít nhất 3 ký tự.'))
        }}
      >
        <h2>Đồng hành gia đình</h2>
        <label>
          Tôi sẽ làm cùng con
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        <button type="submit">Tôi sẽ đồng hành cùng con</button>
        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
      </form>
      <ul>
        {data.supports.map((support) => (
          <li key={support.id}>
            {support.content} · {support.status === 'cancelled' ? 'đã hủy' : 'đang đồng hành'}
            {support.status === 'committed' ? (
              <button
                type="button"
                onClick={() => {
                  void apiJson(`/api/v1/family-supports/${support.id}/cancel`, me.csrfToken, { method: 'POST' }).then(async () => {
                    setMessage('Đã hủy đồng hành.')
                    await client.invalidateQueries({ queryKey: ['child-overview', learnerId] })
                  }).catch(() => setError('Không hủy được lần nữa.'))
                }}
              >
                Hủy
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
