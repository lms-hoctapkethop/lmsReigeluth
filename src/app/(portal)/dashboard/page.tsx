"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ErrorNote, Loading } from "@/components/state"

type Overview = {
  user: { role: string; name: string }
  course: { module: string }
  plans: { done: number; total: number }
  outcomes: { confirmed: number; total: number }
  submission: { receipt: string; versionNo: number } | null
  waitingReview: boolean
  quizCount: number
  exploreDone: boolean
  familyNotes: number
}

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/overview")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được tổng quan.")
        setData(body)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!data) return <Loading />

  const planPercent = data.plans.total ? Math.round((data.plans.done / data.plans.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tổng quan tuần này</h1>
        <p className="mt-1 text-muted-foreground">{data.course.module}. Tiến độ thao tác và mục tiêu đã xác nhận được tính riêng.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Việc trong kế hoạch</p>
          <p className="mt-2 text-2xl font-semibold">
            {data.plans.done}/{data.plans.total}
          </p>
          <Progress className="mt-3" value={planPercent} />
          <Link className="mt-3 inline-block text-sm font-medium text-primary" href="/plans">
            Mở kế hoạch
          </Link>
        </article>
        <article className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Mục tiêu đã xác nhận</p>
          <p className="mt-2 text-2xl font-semibold">
            {data.outcomes.confirmed}/{data.outcomes.total}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.outcomes.confirmed === 0 ? "Chưa đủ bằng chứng để ghi nhận đạt." : "Chỉ tính quyết định giáo viên đã công bố."}
          </p>
        </article>
        <article className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Bài thực hành</p>
          {data.submission ? (
            <>
              <p className="mt-2 font-medium">Lần nộp {data.submission.versionNo}</p>
              <p className="mt-1 text-sm">Mã biên nhận {data.submission.receipt}</p>
              {data.waitingReview ? <Badge className="mt-3" variant="secondary">Đang chờ giáo viên</Badge> : <Badge className="mt-3">Đã có nhận xét</Badge>}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Chưa có bài nộp. Việc đọc và trắc nghiệm không thay cho bài này.</p>
          )}
        </article>
      </div>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-semibold">Việc nên làm tiếp</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>{data.exploreDone ? "Đã đọc phần khám phá." : "Chưa đánh dấu đã đọc phần khám phá."}</li>
          <li>{data.quizCount > 0 ? `Đã luyện tập trắc nghiệm ${data.quizCount} lần.` : "Chưa làm trắc nghiệm luyện tập."}</li>
          <li>{data.familyNotes > 0 ? "Gia đình đã ghi một lần đồng hành." : "Gia đình chưa ghi nhận đồng hành."}</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          {data.user.role === "teacher" ? (
            <Link className="text-sm font-medium text-primary" href="/assessment">
              Mở hàng chờ chấm
            </Link>
          ) : (
            <Link className="text-sm font-medium text-primary" href="/learn">
              Vào bài học
            </Link>
          )}
          <Link className="text-sm font-medium text-primary" href="/records">
            Xem hồ sơ
          </Link>
        </div>
      </section>
    </div>
  )
}
