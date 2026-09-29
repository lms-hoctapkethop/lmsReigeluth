import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"
import { publicUser, withDb, type Role } from "@/lib/db"

const COOKIE = "hcn_session"
const COURSE_COOKIE = "hcn_course"
const SECRET = process.env.SESSION_SECRET || "hoc-cung-nhau-demo-session"

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
}

function sign(value: string) {
  return createHmac("sha256", SECRET).update(value).digest("hex")
}

export function createToken(userId: string) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000
  const payload = `${userId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function readToken(token: string | undefined) {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const payload = `${parts[0]}.${parts[1]}`
  const expected = sign(payload)
  const left = Buffer.from(parts[2])
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  if (Number(parts[1]) < Date.now()) return null
  return parts[0]
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const userId = readToken(jar.get(COOKIE)?.value)
  if (!userId) return null
  return withDb((db) => {
    const user = db.users.find((item) => item.id === userId)
    return user ? publicUser(user) : null
  })
}

export async function setSessionCookie(token: string) {
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function readCourseCookie() {
  const jar = await cookies()
  return jar.get(COURSE_COOKIE)?.value ?? null
}

export async function setCourseCookie(courseId: string) {
  const jar = await cookies()
  jar.set(COURSE_COOKIE, courseId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

export { COOKIE, COURSE_COOKIE }
