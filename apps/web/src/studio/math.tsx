import katex from 'katex'
import 'katex/dist/katex.min.css'

const unsafeTex = /\\(?:href|url|htmlClass)\b/i

/** Chỗ duy nhất được dùng dangerouslySetInnerHTML. KaTeX trust:false, lệnh href/url/htmlClass không được render. */
export function MathTex({ tex }: { tex: string }) {
  if (unsafeTex.test(tex)) return <span>{tex}</span>
  try {
    const html = katex.renderToString(tex, { throwOnError: true, trust: false })
    if (/<a\b|href\s*=|javascript:/i.test(html)) return <span>{tex}</span>
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  } catch {
    return <span>{tex}</span>
  }
}
