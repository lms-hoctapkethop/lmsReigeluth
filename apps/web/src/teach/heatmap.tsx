import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { ApiError, apiJson, retryUnlessDenied } from '../learn/http.ts'
import { ClassNav } from './class-nav.tsx'
import styles from './heatmap.module.css'

type Status = 'insufficient' | 'needs_support' | 'developing' | 'strong'

const label: Record<Status, string> = {
  insufficient: 'Chưa đủ bằng chứng',
  needs_support: 'Cần hỗ trợ',
  developing: 'Đang phát triển',
  strong: 'Có bằng chứng tốt',
}

type Heatmap = {
  kcs: { kcVersionId: string; name: string; topoIndex: number }[]
  learners: { learnerId: string; name: string }[]
  cells: { learnerId: string; kcVersionId: string; status: Status; nObservations: number; value?: number | null }[]
  rootGaps: { learnerId: string; groups: { root: string; affected: string[]; capped: boolean }[] }[]
  modelVersion: string
  lastUpdatedAt: string | null
}

function when(value: string | null): string {
  if (!value) return 'chưa có'
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function HeatmapPage() {
  const { id = '' } = useParams()
  const [showValues, setShowValues] = useState(false)
  const heatmap = useQuery({
    queryKey: ['heatmap', id, showValues],
    queryFn: () => apiJson<Heatmap>(`/api/v1/offerings/${id}/heatmap?includeValues=${showValues ? 'true' : 'false'}`),
    retry: retryUnlessDenied,
    refetchInterval: (query) => {
      const cells = query.state.data?.cells ?? []
      return cells.some((cell) => cell.status !== 'insufficient') ? false : 2000
    },
  })
  return (
    <section className={styles.stack}>
      <ClassNav offeringId={id} current="heatmap" />
      <h1>Bản đồ nhiệt</h1>
      {heatmap.isLoading ? <p>Đang tải bản đồ nhiệt.</p> : null}
      {heatmap.error instanceof ApiError && (heatmap.error.status === 404 || heatmap.error.status === 403) ? (
        <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
      ) : null}
      {heatmap.isError && !(heatmap.error instanceof ApiError && heatmap.error.status >= 400 && heatmap.error.status < 500) ? (
        <p role="alert">Không tải được bản đồ nhiệt. <button type="button" onClick={() => void heatmap.refetch()}>Thử lại</button></p>
      ) : null}
      {heatmap.data ? <HeatmapGrid data={heatmap.data} showValues={showValues} onToggle={setShowValues} /> : null}
    </section>
  )
}

function HeatmapGrid({ data, showValues, onToggle }: { data: Heatmap; showValues: boolean; onToggle: (value: boolean) => void }) {
  const nameByVersion = new Map(data.kcs.map((kc) => [kc.kcVersionId, kc.name]))
  return (
    <>
      <p>cập nhật lúc {when(data.lastUpdatedAt)} · {data.modelVersion}</p>
      <label>
        <input type="checkbox" checked={showValues} onChange={(event) => onToggle(event.target.checked)} /> Hiện giá trị số
      </label>
      {data.learners.length === 0 ? <p>Chưa có học sinh ghi danh.</p> : null}
      {data.kcs.length === 0 ? <p>Chưa có KC đã giao trong lớp này.</p> : null}
      {data.learners.length > 0 && data.kcs.length > 0 ? (
        <div className={styles.wrap}>
          <table>
            <caption>Học sinh và thành phần kiến thức</caption>
            <thead>
              <tr>
                <th scope="col">Học sinh</th>
                {data.kcs.map((kc) => <th key={kc.kcVersionId} scope="col">{kc.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.learners.map((learner) => (
                <tr key={learner.learnerId}>
                  <th scope="row">{learner.name}</th>
                  {data.kcs.map((kc) => {
                    const cell = data.cells.find((item) => item.learnerId === learner.learnerId && item.kcVersionId === kc.kcVersionId)
                    const status = cell?.status ?? 'insufficient'
                    const text = label[status]
                    const value = showValues && cell && 'value' in cell && cell.value !== undefined && cell.value !== null ? ` ${cell.value.toLocaleString('vi-VN', { maximumFractionDigits: 4 })}` : ''
                    return (
                      <td key={kc.kcVersionId}>
                        <div className={`${styles.cell} ${styles[status]}`} title={text}>{text}{value}</div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <section aria-labelledby="root-gaps">
        <h2 id="root-gaps">Hổng gốc</h2>
        {data.rootGaps.every((row) => row.groups.length === 0) ? <p>Chưa có hổng gốc.</p> : null}
        {data.rootGaps.flatMap((row) => row.groups.map((group) => {
          const learner = data.learners.find((item) => item.learnerId === row.learnerId)?.name ?? row.learnerId
          const root = nameByVersion.get(group.root) ?? group.root
          const affected = group.affected.map((id) => nameByVersion.get(id) ?? id).join(', ')
          return (
            <article key={`${row.learnerId}:${group.root}`} className={styles.group}>
              <h3>{learner}: {root}</h3>
              <p>Ảnh hưởng: {affected}</p>
              {group.capped ? <p>Nên trao đổi trực tiếp</p> : null}
            </article>
          )
        }))}
      </section>
    </>
  )
}
