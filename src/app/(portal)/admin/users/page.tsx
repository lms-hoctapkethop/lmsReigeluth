"use client"

import { useEffect, useState } from "react"
import { ErrorNote, Loading } from "@/components/state"

type Row = { id: string; name: string; email: string; roleLabel: string; status: string }

export default function AdminUsersPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin/users")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được tài khoản.")
        setRows(body.users)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!rows) return <Loading label="Đang tải tài khoản..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Tài khoản</h1>
        <p className="mt-2 text-[#5b6476]">Vai trò trong trường. Mật khẩu không hiện ở đây.</p>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <article key={row.id} className="surface p-4">
            <p className="font-semibold">{row.name}</p>
            <p className="text-sm text-[#5b6476]">{row.email}</p>
            <p className="mt-2 text-sm">{row.roleLabel} · {row.status}</p>
          </article>
        ))}
      </div>
      <div className="surface hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Tài khoản trong trường</caption>
          <thead className="border-b border-[#d9ddea] text-[#5b6476]">
            <tr>
              <th className="px-4 py-3 font-medium">Tên</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Vai trò</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[#d9ddea] last:border-0">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">{row.roleLabel}</td>
                <td className="px-4 py-3">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
