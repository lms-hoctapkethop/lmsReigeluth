import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { apiJson } from './http.ts'
import styles from './learn.module.css'

type Release = { id: string; title: string; dueAt: string | null }

export function LearnClass() {
  const { id = '' } = useParams()
  const releases = useQuery({
    queryKey: ['class-releases', id],
    queryFn: () => apiJson<Release[]>(`/api/v1/offerings/${id}/releases`),
  })
  return (
    <section className={styles.stack}>
      <h1>Bài của lớp</h1>
      {releases.isLoading ? <p>Đang tải bài.</p> : null}
      {releases.isError ? <p role="alert">Không tải được bài của lớp.</p> : null}
      {releases.data && releases.data.length === 0 ? <p>Lớp chưa có bài được giao.</p> : null}
      <ul>
        {releases.data?.map((item) => (
          <li key={item.id}>
            <Link to={`/hoc/bai/${item.id}`}>{item.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
