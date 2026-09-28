import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Be_Vietnam_Pro } from "next/font/google"
import "./globals.css"

const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
})

export const metadata: Metadata = {
  title: "Học cùng nhau",
  description: "Không gian học tập cho lớp Tin học 10: kế hoạch, bài làm, đánh giá và hồ sơ.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} h-full antialiased`}>
      <body className={`${sans.className} min-h-full`}>{children}</body>
    </html>
  )
}
