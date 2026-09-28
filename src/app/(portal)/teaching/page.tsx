"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ErrorNote, Loading } from "@/components/state"

type Payload = {
  course: { name: string; module: string }
  roster: { name: string; className: string; course: string }[]
  latest: { versionNo: number } | null
}

export default function TeachingPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/teaching")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setData(body)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!data) return <Loading />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lớp học phần</h1>
        <p className="mt-1 text-muted-foreground">
          {data.course.name} · {data.course.module}. Lớp hành chính không tự mở mọi khóa học.
        </p>
      </div>
      <ul className="space-y-3">
        {data.roster.map((person) => (
          <li key={person.name} className="surface p-4">
            <p className="font-medium">{person.name}</p>
            <p className="text-sm text-muted-foreground">Lớp {person.className} · {person.course}</p>
            <p className="mt-2 text-sm">{data.latest ? `Có lần nộp ${data.latest.versionNo}.` : "Chưa nộp bài thực hành."}</p>
          </li>
        ))}
      </ul>
      <Link className="text-sm font-medium text-primary" href="/assessment">
        Mở hàng chờ phản hồi
      </Link>
    </div>
  )
}
