import Link from "next/link"

const areas = [
  { href: "/admin/users", title: "Tài khoản", text: "Xem người trong trường và vai trò. Không hiện mật khẩu." },
  { href: "/admin/organization", title: "Tổ chức học", text: "Tên trường, lớp hành chính và lớp học phần đang mở." },
  { href: "/admin/links", title: "Liên kết gia đình", text: "Xác minh hoặc thu hồi quyền phụ huynh xem hồ sơ của con." },
  { href: "/admin/audit", title: "Nhật ký", text: "Ai đã nộp bài, phản hồi, phát hành nội dung hoặc đổi tổ chức." },
]

export default function AdminHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold md:text-[28px]">Quản trị nhà trường</h1>
        <p className="mt-2 max-w-3xl text-[#5b6476]">Một trường, một lớp học phần. Quản trị không chấm bài và không nộp bài thay học sinh.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {areas.map((area) => (
          <Link key={area.href} href={area.href} className="surface block p-4 md:p-6">
            <h2 className="text-xl font-semibold">{area.title}</h2>
            <p className="mt-2 text-[#5b6476]">{area.text}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
