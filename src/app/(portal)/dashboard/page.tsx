"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ErrorNote, Loading, formatWhen } from "@/components/state"

type Task = { id: string; title: string; due: string; source: "assigned" | "personal"; done: boolean }
type Overview = {
  user: { role: string; name: string }
  course: { name: string; module: string }
  learner: { name: string; className: string }
  plans: { done: number; total: number }
  weekTasks: Task[]
  nextTask: { title: string; due: string; reason: string; href: string } | null
  activities: { done: number; total: number }
  outcomes: { confirmed: number; total: number }
  submission: { receipt: string; versionNo: number; submittedAt: string } | null
  feedback: { teacher: string; at: string; excerpt: string } | null
  waitingReview: boolean
  familyNotes: number
}

function day(iso: string) {
  const [year, month, date] = iso.split("-")
  return `${date}/${month}/${year}`
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
  if (data.user.role === "teacher") return <TeacherHome data={data} />
  if (data.user.role === "guardian") return <GuardianHome data={data} />
  return <StudentHome data={data} />
}

function StudentHome({ data }: { data: Overview }) {
  const first = data.user.name.split(" ").slice(-1)[0]
  const metrics = [
    {
      href: "/plans",
      label: "Hoạt động đã hoàn thành",
      value: `${data.activities.done}/${data.activities.total}`,
      note: "Đã làm xong việc, chưa phải mục tiêu được xác nhận",
      className: "bg-[#eeedff] text-[#5150df]",
    },
    {
      href: "/learn",
      label: "Bài chờ phản hồi",
      value: data.waitingReview ? "1" : "0",
      note: data.waitingReview ? "Đã nộp bài, giáo viên chưa công bố nhận xét" : "Không có bài đang chờ",
      className: "bg-[#eff6ff] text-[#1e40af]",
    },
    {
      href: "/records",
      label: "Mục tiêu đã xác nhận",
      value: `${data.outcomes.confirmed}/${data.outcomes.total}`,
      note: data.outcomes.confirmed ? "Có quyết định của giáo viên" : "Chưa đánh giá",
      className: "bg-[#f0fdf4] text-[#166534]",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Chào {first}</h1>
        <p className="mt-2 text-[#5b6476]">
          {data.course.name} · Lớp {data.learner.className}. Hôm nay em nên làm việc tiếp theo bên dưới.
        </p>
      </div>
      <section className="surface p-4 md:p-6">
        <p className="text-sm font-medium text-[#5150df]">Việc tiếp theo</p>
        {data.nextTask ? (
          <>
            <h2 className="mt-2 text-xl font-semibold">{data.nextTask.title}</h2>
            <p className="mt-2 max-w-3xl text-[#5b6476]">
              Hạn {day(data.nextTask.due)}. {data.nextTask.reason}
            </p>
            <Link className="mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-[#5150df] px-4 text-sm font-medium text-white hover:bg-[#4342c4]" href={data.nextTask.href}>
              Tiếp tục học
            </Link>
          </>
        ) : (
          <p className="mt-2 text-[#5b6476]">Chưa có hoạt động được giao.</p>
        )}
      </section>
      <div className="grid gap-6 md:grid-cols-3">
        {metrics.map((card) => (
          <Link key={card.label} href={card.href} className={`rounded-2xl p-4 md:p-6 ${card.className}`}>
            <p className="text-sm font-medium">{card.label}</p>
            <p className="mt-2 text-[28px] leading-none font-bold">{card.value}</p>
            <p className="mt-2 text-sm">{card.note}</p>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <section className="surface p-4 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Nhiệm vụ tuần</h2>
            <Link className="text-sm font-medium text-[#5150df]" href="/plans">
              Xem tất cả kế hoạch
            </Link>
          </div>
          {data.weekTasks.length === 0 ? (
            <p className="mt-4 text-[#5b6476]">Tuần này chưa có việc trong kế hoạch.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[#d9ddea]">
              {data.weekTasks.map((task) => (
                <li key={task.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-[#5b6476]">
                      {task.source === "assigned" ? "Được giao" : "Việc cá nhân"} · hạn {day(task.due)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-sm ${task.done ? "bg-[#f0fdf4] text-[#166534]" : "bg-[#fffbeb] text-[#92400e]"}`}>
                    {task.done ? "Đã hoàn thành hoạt động" : "Chưa xong"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-6">
          <Feedback data={data} />
          <Support data={data} />
        </div>
      </div>
      <p className="text-sm text-[#5b6476]">
        Hoàn thành một việc không tự xác nhận mục tiêu.{" "}
        <Link className="font-medium text-[#5150df]" href="/about">
          Xem mô hình học
        </Link>
      </p>
    </div>
  )
}

function TeacherHome({ data }: { data: Overview }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Lớp đang phụ trách</h1>
        <p className="mt-2 text-[#5b6476]">
          {data.course.name} · {data.learner.className} · {data.learner.name}. Số liệu dưới đây là việc cần phản hồi, không phải tỷ lệ năng lực của lớp.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Link href="/assessment" className="rounded-2xl bg-[#eff6ff] p-4 text-[#1e40af] md:p-6">
          <p className="text-sm font-medium">Bài đang chờ phản hồi</p>
          <p className="mt-2 text-[28px] leading-none font-bold">{data.waitingReview ? "1" : "0"}</p>
          <p className="mt-2 text-sm">{data.waitingReview ? "Mở bài để công bố nhận xét." : "Hàng chờ đang trống."}</p>
        </Link>
        <Link href="/teaching" className="rounded-2xl bg-[#eeedff] p-4 text-[#5150df] md:p-6">
          <p className="text-sm font-medium">Lớp học phần</p>
          <p className="mt-2 text-xl font-semibold">{data.course.module}</p>
          <p className="mt-2 text-sm">Một lớp, một học sinh trong lát cắt này.</p>
        </Link>
      </div>
      <section className="surface p-4 md:p-6">
        <h2 className="text-xl font-semibold">Xem trước hàng chờ</h2>
        {data.submission && data.waitingReview ? (
          <p className="mt-3 text-[#5b6476]">
            {data.learner.name} đã nộp lần {data.submission.versionNo} lúc {formatWhen(data.submission.submittedAt)}. Biên nhận {data.submission.receipt}.
          </p>
        ) : (
          <p className="mt-3 text-[#5b6476]">Chưa có bài mới cần phản hồi.</p>
        )}
        <Link className="mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-[#5150df] px-4 text-sm font-medium text-white hover:bg-[#4342c4]" href="/assessment">
          Mở bài
        </Link>
      </section>
    </div>
  )
}

function GuardianHome({ data }: { data: Overview }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">{data.learner.name}</h1>
        <p className="mt-2 text-[#5b6476]">
          Lớp {data.learner.className} · {data.course.name}. Đây là hồ sơ được phép xem, không phải tài khoản của phụ huynh để nộp bài.
        </p>
      </div>
      <section className="surface p-4 md:p-6">
        <h2 className="text-xl font-semibold">Điều cần chú ý</h2>
        {data.nextTask ? (
          <p className="mt-2 text-[#5b6476]">
            {data.nextTask.title}, hạn {day(data.nextTask.due)}. Con đang cần hoàn thành việc này; việc xong chưa có nghĩa mục tiêu đã được xác nhận.
          </p>
        ) : (
          <p className="mt-2 text-[#5b6476]">Tuần này chưa có việc trong kế hoạch.</p>
        )}
        <Link className="mt-4 inline-block text-sm font-medium text-[#5150df]" href="/plans">
          Xem kế hoạch
        </Link>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <article className="rounded-2xl bg-[#eeedff] p-4 text-[#5150df] md:p-6">
          <p className="text-sm font-medium">Hoạt động đã hoàn thành</p>
          <p className="mt-2 text-[28px] leading-none font-bold">
            {data.activities.done}/{data.activities.total}
          </p>
        </article>
        <article className="rounded-2xl bg-[#f0fdf4] p-4 text-[#166534] md:p-6">
          <p className="text-sm font-medium">Mục tiêu đã xác nhận</p>
          <p className="mt-2 text-[28px] leading-none font-bold">
            {data.outcomes.confirmed}/{data.outcomes.total}
          </p>
          <p className="mt-2 text-sm">{data.outcomes.confirmed ? "Có quyết định của giáo viên." : "Chưa đánh giá."}</p>
        </article>
      </div>
      <Feedback data={data} empty="Giáo viên chưa công bố phản hồi." />
      <Support data={data} />
    </div>
  )
}

function Feedback({ data, empty = "Chưa có phản hồi mới." }: { data: Overview; empty?: string }) {
  return (
    <section className="surface p-4 md:p-6">
      <h2 className="text-xl font-semibold">Phản hồi mới</h2>
      {data.feedback ? (
        <>
          <p className="mt-2 text-sm text-[#5b6476]">
            {data.feedback.teacher} · {formatWhen(data.feedback.at)}
          </p>
          <p className="mt-2 text-[#22263b]">{data.feedback.excerpt}</p>
          <Link className="mt-3 inline-block text-sm font-medium text-[#5150df]" href="/learn">
            Đọc phản hồi
          </Link>
        </>
      ) : (
        <p className="mt-2 text-[#5b6476]">{empty}</p>
      )}
    </section>
  )
}

function Support({ data }: { data: Overview }) {
  return (
    <section className="surface p-4 md:p-6">
      <h2 className="text-xl font-semibold">Hỗ trợ gia đình</h2>
      <p className="mt-2 text-[#5b6476]">
        {data.familyNotes > 0
          ? "Gia đình đã ghi một cam kết đồng hành. Cam kết này không làm tăng tiến độ của con."
          : "Chưa có cam kết đồng hành."}
      </p>
      <Link className="mt-3 inline-block text-sm font-medium text-[#5150df]" href={data.user.role === "guardian" ? "/family" : "/records"}>
        Xem chi tiết
      </Link>
    </section>
  )
}
