import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const absolute = path.join(process.cwd(), "src", specifier.slice(2))
    const file = existsSync(`${absolute}.ts`) ? `${absolute}.ts` : absolute
    return nextResolve(pathToFileURL(file).href, context)
  }
  return nextResolve(specifier, context)
}
