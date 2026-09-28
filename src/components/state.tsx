export function Loading({ label = "Đang tải dữ liệu lớp..." }: { label?: string }) {
  return (
    <p className="text-muted-foreground" role="status">
      {label}
    </p>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-[10px] border border-[#b91c1c] bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]" role="alert">
      {message}
    </p>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">{children}</p>
}

export function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(iso))
}
