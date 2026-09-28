import { jsonError, verifyPassword, withDb, publicUser, HttpError } from "@/lib/db"
import { clearSessionCookie, createToken, getSessionUser, setSessionCookie } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ user: null }, { status: 401 })
  return Response.json({ user })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string }
    const email = body.email?.trim().toLowerCase() ?? ""
    const password = body.password ?? ""
    const user = await withDb((db) => {
      const found = db.users.find((item) => item.email === email)
      if (!found || !verifyPassword(password, found.passwordSalt, found.passwordHash)) {
        throw new HttpError(401, "Email hoặc mật khẩu chưa đúng.")
      }
      return publicUser(found)
    })
    await setSessionCookie(createToken(user.id))
    return Response.json({ user })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE() {
  await clearSessionCookie()
  return Response.json({ ok: true })
}
