import { readFileSync } from "fs"
import path from "path"

type AuthoringEntry = { body?: string; prompt?: string; href?: string }

let table: Record<string, AuthoringEntry> | null = null

function loadTable() {
  if (table) return table
  const file = path.join(process.cwd(), "content", "authoring-text.json")
  table = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Record<string, AuthoringEntry>
  return table
}

export function suggestAuthoring(moduleKey: string) {
  const entries = loadTable()
  return {
    pageBody: entries[`${moduleKey}-READ`]?.body ?? "",
    assignmentPrompt: entries[`${moduleKey}-WORK`]?.prompt ?? "",
    linkHref: entries[`${moduleKey}-LINK`]?.href ?? "",
    note: "Nội dung đề xuất, chờ thẩm định chuyên gia. Hãy sửa nếu cần, lưu bản soạn, rồi mới giao cho lớp.",
  }
}
