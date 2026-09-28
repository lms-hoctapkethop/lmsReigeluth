import { HttpError, recordAudit, type Db, type GuardianLink, type OrgProfile } from "@/lib/db"
import type { SessionUser } from "@/lib/session"

export function requireAdmin(user: SessionUser) {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ quản trị nhà trường mới mở được mục này.")
}

const roleLabel: Record<string, string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  guardian: "Phụ huynh",
  admin: "Quản trị",
}

export function adminUsers(db: Db, user: SessionUser) {
  requireAdmin(user)
  return {
    users: db.users.map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      roleLabel: roleLabel[item.role] ?? item.role,
      status: "Đang hiệu lực",
    })),
  }
}

export function adminOrg(db: Db, user: SessionUser) {
  requireAdmin(user)
  return { org: db.org, link: db.guardianLink }
}

export function saveOrg(db: Db, user: SessionUser, input: OrgProfile) {
  requireAdmin(user)
  const org: OrgProfile = {
    school: clip(input.school, "Tên trường"),
    className: clip(input.className, "Lớp"),
    courseTitle: clip(input.courseTitle, "Khóa học"),
    offeringTitle: clip(input.offeringTitle, "Lớp học phần"),
    weekLabel: clip(input.weekLabel, "Tuần học"),
  }
  db.org = org
  recordAudit(db, { actorId: user.id, actorName: user.name, action: "Cập nhật tổ chức học", target: org.offeringTitle })
  return { org }
}

export function saveLink(db: Db, user: SessionUser, input: { status?: GuardianLink["status"]; reason?: string }) {
  requireAdmin(user)
  const status = input.status
  if (status !== "pending" && status !== "active" && status !== "revoked") {
    throw new HttpError(400, "Trạng thái liên kết không hợp lệ.")
  }
  const reason = (input.reason ?? "").trim().slice(0, 300)
  if (reason.length < 8) throw new HttpError(400, "Hãy ghi lý do xác minh hoặc thu hồi, ít nhất một câu.")
  db.guardianLink = {
    ...db.guardianLink,
    status,
    reason,
    verifiedAt: status === "active" ? new Date().toISOString() : db.guardianLink.verifiedAt,
  }
  recordAudit(db, { actorId: user.id, actorName: user.name, action: "Cập nhật liên kết gia đình", target: status })
  return { link: db.guardianLink }
}

export function adminAudit(db: Db, user: SessionUser) {
  requireAdmin(user)
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  return { events: db.audit.filter((item) => new Date(item.at).getTime() >= cutoff).slice(0, 100) }
}

function clip(value: string | undefined, label: string) {
  const text = (value ?? "").trim().slice(0, 120)
  if (text.length < 2) throw new HttpError(400, `${label} còn quá ngắn.`)
  return text
}
