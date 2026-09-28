"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEMO_ACCOUNTS } from "@/lib/accounts"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email)
  const [password, setPassword] = useState(DEMO_ACCOUNTS[0].password)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(body.error || "Không đăng nhập được.")
        return
      }
      router.push("/dashboard")
      router.refresh()
    } catch {
      setError("Mất kết nối. Hãy thử lại.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-5xl flex-col justify-center gap-8 px-4 py-10 md:flex-row md:items-stretch">
      <section className="flex-1 rounded-2xl bg-primary px-6 py-8 text-primary-foreground md:px-10">
        <p className="text-sm font-medium uppercase tracking-wide opacity-80">Một trường · Lớp 10A1</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Học cùng nhau</h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-white/90">
          Nơi học sinh lập kế hoạch, làm bài, nhận phản hồi và để gia đình thấy tiến độ thật — không chỉ một nút đổi vai trò.
        </p>
        <ul className="mt-8 space-y-2 text-sm text-white/90">
          <li>Tin học 10 · Bài rẽ nhánh if–else</li>
          <li>Tuần 28/09 – 04/10/2026</li>
          <li>Học sinh, giáo viên và phụ huynh dùng tài khoản riêng</li>
        </ul>
      </section>
      <section className="w-full max-w-md rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <h2 className="text-xl font-semibold">Đăng nhập</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ba tài khoản minh họa dùng chung một lớp học phần.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="w-full" size="lg" type="submit" disabled={pending}>
            {pending ? "Đang vào lớp..." : "Vào lớp học"}
          </Button>
        </form>
        <div className="mt-6 space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="flex w-full items-center justify-between rounded-lg bg-muted px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring"
              onClick={() => {
                setEmail(account.email)
                setPassword(account.password)
              }}
            >
              <span>
                <span className="font-medium">{account.name}</span>
                <span className="block text-muted-foreground">{account.hint}</span>
              </span>
              <span className="text-xs text-muted-foreground">{account.password}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}
