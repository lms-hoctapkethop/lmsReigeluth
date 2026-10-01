import { Link } from 'react-router'

export function ClassNav({ offeringId, current }: { offeringId: string; current: 'heatmap' | 'assign' | 'review' }) {
  return (
    <nav aria-label="Theo dõi lớp">
      <Link to={`/day/lop/${offeringId}`} aria-current={current === 'heatmap' ? 'page' : undefined}>Bản đồ nhiệt</Link>
      {' · '}
      <Link to={`/day/lop/${offeringId}/giao`} aria-current={current === 'assign' ? 'page' : undefined}>Giao bài</Link>
      {' · '}
      <Link to={`/day/cham/${offeringId}`} aria-current={current === 'review' ? 'page' : undefined}>Chấm bài</Link>
    </nav>
  )
}
