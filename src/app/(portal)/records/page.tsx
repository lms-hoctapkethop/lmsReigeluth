"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { EmptyNote, ErrorNote, Loading, formatWhen } from "@/components/state"

type Outcome = { id: string; title: string; label: string; status: string; reason?: string }
type Payload = {
  outcomes: Outcome[]
  versions: { versionNo: number; submittedAt: string; receipt: string }[]
  reviews: { versionNo: number; publishedAt: string; criteria: { label: string; met: boolean; note: string }[] }[]
  note: string
}

export default function RecordsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/records")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setData(body)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!data) return <Loading label="Đang mở hồ sơ..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hồ sơ tiến bộ</h1>
        <p className="mt-1 text-muted-foreground">{data.note}</p>
      </div>
      <ul className="space-y-3">
        {data.outcomes.map((outcome) => (
          <li key={outcome.id} className="surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{outcome.title}</p>
              <Badge variant={outcome.status === "met" ? "default" : "secondary"}>{outcome.label}</Badge>
            </div>
            {outcome.reason ? <p className="mt-2 text-sm text-muted-foreground">{outcome.reason}</p> : null}
          </li>
        ))}
      </ul>
      <section>
        <h2 className="font-semibold">Minh chứng đã nộp</h2>
        {data.versions.length === 0 ? <EmptyNote>Chưa có lần nộp để đưa vào hồ sơ.</EmptyNote> : null}
        <ul className="mt-3 space-y-2 text-sm">
          {data.versions.map((version) => (
            <li key={version.versionNo}>
              Lần {version.versionNo} · {version.receipt} · {formatWhen(version.submittedAt)}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Nhận xét đã công bố</h2>
        {data.reviews.length === 0 ? <EmptyNote>Chưa có nhận xét công bố.</EmptyNote> : null}
        {data.reviews.map((review) => (
          <article key={review.publishedAt} className="surface p-4 text-sm">
            <p className="font-medium">Lần nộp {review.versionNo} · {formatWhen(review.publishedAt)}</p>
            <ul className="mt-2 space-y-1">
              {review.criteria.map((criterion) => (
                <li key={criterion.label}>
                  {criterion.label}: {criterion.met ? "Đạt" : "Chưa đạt"}
                  {criterion.note ? ` — ${criterion.note}` : ""}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </div>
  )
}
