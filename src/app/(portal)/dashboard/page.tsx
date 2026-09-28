"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
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

  const first = data.user.name.split(" ").slice(-1)[0]
  const planPercent = data.plans.total ? Math.round((data.plans.done / data.plans.total) * 100) : 0
  const cards = [
    { label: "Việc trong tuần", value: `${data.plans.done}/${data.plans.total}`, tone: "text-[#5150df]", wash: "bg-[#f0f0fd]", note: "Kế hoạch đã xong" },
    { label: "Mục tiêu xác nhận", value: `${data.outcomes.confirmed}/${data.outcomes.total}`, tone: "text-[#168370]", wash: "bg-[#ebf7f2]", note: data.outcomes.confirmed ? "Đã có quyết định" : "Chưa đủ bằng chứng" },
    { label: "Bài thực hành", value: data.submission ? `Lần ${data.submission.versionNo}` : "Chưa nộp", tone: "text-[#2563eb]", wash: "bg-[#eef4ff]", note: data.waitingReview ? "Đang chờ giáo viên" : data.submission ? "Đã có nhận xét" : "Nộp để nhận biên nhận" },
    { label: "Luyện tập", value: data.quizCount ? `${data.quizCount} lượt` : "Chưa làm", tone: "text-[#d4880f]", wash: "bg-[#fff6e9]", note: "Không tự xác nhận mục tiêu" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#22263b]">Chào {first}</h1>
        <p className="mt-1 text-[#69718a]">{data.course.module}. Việc đã làm và mục tiêu đã được xác nhận được tính riêng.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className={`rounded-2xl p-4 ${card.wash}`}>
            <p className="text-sm text-[#69718a]">{card.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${card.tone}`}>{card.value}</p>
            <p className="mt-1 text-sm text-[#69718a]">{card.note}</p>
          </article>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <section className="surface p-5">
          <p className="text-xs font-medium tracking-wide text-[#5150df] uppercase">Việc chính</p>
          <h2 className="mt-2 text-lg font-semibold">Rẽ nhánh if–else</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#69718a]">
            {data.exploreDone ? "Đã đọc phần khám phá." : "Bắt đầu bằng phần khám phá."}{" "}
            {data.submission ? `Bài thực hành có biên nhận ${data.submission.receipt}.` : "Bài thực hành chưa được nộp."}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#ecebff]">
            <div className="h-full rounded-full bg-[#5150df]" style={{ width: `${planPercent}%` }} />
          </div>
          <p className="mt-2 text-sm text-[#69718a]">{planPercent}% việc trong kế hoạch tuần</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link className="rounded-xl bg-[#5150df] px-4 py-2 text-sm font-medium text-white" href={data.user.role === "teacher" ? "/assessment" : "/learn"}>
              {data.user.role === "teacher" ? "Mở hàng chờ" : "Vào bài học"}
            </Link>
            <Link className="rounded-xl bg-[#ecebff] px-4 py-2 text-sm font-medium text-[#3a34b0]" href="/plans">
              Xem kế hoạch
            </Link>
          </div>
        </section>
        <aside className="surface p-5">
          <h2 className="font-semibold">Hỗ trợ</h2>
          <ul className="mt-3 space-y-3 text-sm text-[#3d4660]">
            <li className="rounded-xl bg-[#f4f7ff] px-3 py-2">{data.familyNotes > 0 ? "Gia đình đã ghi nhận đồng hành." : "Gia đình chưa ghi nhận đồng hành."}</li>
            <li className="rounded-xl bg-[#f3fbf7] px-3 py-2">{data.exploreDone ? "Phần khám phá đã được đánh dấu." : "Phần khám phá vẫn đang mở."}</li>
            <li className="rounded-xl bg-[#fff8ee] px-3 py-2">Đạt mục tiêu chỉ sau khi giáo viên công bố nhận xét.</li>
          </ul>
          <Link className="mt-4 inline-block text-sm font-medium text-[#5150df]" href="/records">
            Mở hồ sơ tiến bộ
          </Link>
        </aside>
      </div>
    </div>
  )
}
