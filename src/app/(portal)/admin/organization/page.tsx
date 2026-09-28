"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorNote, Loading } from "@/components/state"

type Org = { school: string; className: string; courseTitle: string; offeringTitle: string; weekLabel: string }

const empty: Org = { school: "", className: "", courseTitle: "", offeringTitle: "", weekLabel: "" }

export default function OrganizationPage() {
  const [org, setOrg] = useState<Org>(empty)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    fetch("/api/admin/organization")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Không tải được tổ chức học.")
        setOrg(body.org)
        setReady(true)
      })
      .catch((reason: Error) => setError(reason.message || "Lỗi mạng."))
  }, [])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError("")
    setNotice("")
    try {
      const response = await fetch("/api/admin/organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(org),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Chưa lưu được.")
      setOrg(body.org)
      setNotice("Đã lưu. Thanh đầu trang sẽ hiện tên lớp học phần mới.")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lỗi mạng.")
    } finally {
      setPending(false)
    }
  }

  if (error && !ready) return <ErrorNote message={error} />
  if (!ready) return <Loading label="Đang tải tổ chức học..." />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Tổ chức học</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">Lớp hành chính là 10A1. Lớp học phần là lần học Tin học 10, không tự mở mọi khóa của trường.</p>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-[10px] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]" role="status">{notice}</p> : null}
      <form className="surface max-w-xl space-y-4 p-4 md:p-6" onSubmit={save}>
        <OrgField label="Trường" id="school" value={org.school} onChange={(school) => setOrg({ ...org, school })} />
        <OrgField label="Lớp hành chính" id="class" value={org.className} onChange={(className) => setOrg({ ...org, className })} />
        <OrgField label="Khóa học" id="course" value={org.courseTitle} onChange={(courseTitle) => setOrg({ ...org, courseTitle })} />
        <OrgField label="Lớp học phần" id="offering" value={org.offeringTitle} onChange={(offeringTitle) => setOrg({ ...org, offeringTitle })} />
        <OrgField label="Tuần đang học" id="week" value={org.weekLabel} onChange={(weekLabel) => setOrg({ ...org, weekLabel })} />
        <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu tổ chức học"}</Button>
      </form>
    </div>
  )
}

function OrgField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} required />
    </div>
  )
}
