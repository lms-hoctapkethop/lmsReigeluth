import { mkdtempSync } from "node:fs"
import { register } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

if (!process.env.HCN_DB_PATH) {
  const dir = mkdtempSync(path.join(tmpdir(), "hcn-p1a-"))
  process.env.HCN_DB_PATH = path.join(dir, "db.json")
  process.env.HCN_LOCK_PATH = path.join(dir, "writer.lock")
}

register(pathToFileURL(path.join(process.cwd(), "tests/hooks.mjs")).href, {
  parentURL: pathToFileURL(path.join(process.cwd(), "tests/register.mjs")).href,
})
