"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ErrorNote, Loading, formatWhen } from "@/components/state"

type ModuleDoc = {
  title: string
  summary: string
  status: "draft" | "published"
  version: number
  updatedAt: string | null
}

export default function ContentLibraryPage() {
  const [published, setPublished] = useState<ModuleDoc | null>(null)
  const [draft, setDraft] = useState<ModuleDoc | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/content")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được nội dung.")
        setPublished(body.published)
        setDraft(body.draft)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!published || !draft) return <Loading label="Đang tải thư viện nội dung..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Nội dung khóa học</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">
          Học sinh chỉ thấy bản đã phát hành của bài trên mục Khóa học, trong khóa đang chọn ở thanh đầu trang. Phát hành ở đây thay bài đó của khóa này. Để soạn một bài khác và giao cho lớp, mở <Link className="font-medium text-[#5150df]" href="/teaching/modules">Soạn và giao</Link>.
        </p>
      </div>
      <article className="surface p-4 md:p-6">
        <p className="text-sm font-medium text-[#166534]">Đã phát hành · phiên bản {published.version}</p>
        <h2 className="mt-2 text-xl font-semibold">{published.title}</h2>
        <p className="mt-2 text-[#5b6476]">{published.summary}</p>
        <p className="mt-2 text-sm text-[#5b6476]">{published.updatedAt ? `Cập nhật ${formatWhen(published.updatedAt)}` : "Bản gốc của tuần này."}</p>
      </article>
      <article className="surface p-4 md:p-6">
        <p className="text-sm font-medium text-[#92400e]">Bản nháp</p>
        <h2 className="mt-2 text-xl font-semibold">{draft.title}</h2>
        <p className="mt-2 text-[#5b6476]">{draft.summary || "Chưa có tóm tắt."}</p>
        <Link className="mt-4 inline-flex min-h-11 items-center rounded-[10px] bg-[#5150df] px-4 text-sm font-medium text-white hover:bg-[#4342c4]" href="/teaching/content/edit">
          Sửa bản nháp
        </Link>
      </article>
    </div>
  )
}
