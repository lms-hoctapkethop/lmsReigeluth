import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, redirect, RouterProvider, useLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { fetchMe, logout, switchContext } from './api.ts'
import { roleLabel } from './labels.ts'
import styles from './shell.module.css'
import './ui/tokens.css'

const queryClient = new QueryClient()

async function rootLoader(): Promise<Me> {
  const me = await queryClient.fetchQuery({ queryKey: ['me'], queryFn: fetchMe })
  if (!me) throw redirect('/login-required?returnTo=/')
  return me
}

function LoginRequired() {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('returnTo')
  const returnTo = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : window.location.pathname
  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <h1>Đăng nhập</h1>
        <p>Bạn cần đăng nhập để tiếp tục học cùng nhau.</p>
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
          }}
        >
          Đăng nhập
        </button>
      </section>
    </main>
  )
}

function Shell() {
  const initial = useLoaderData() as Me
  const client = useQueryClient()
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, initialData: initial })
  const me = meQuery.data ?? initial
  const activeLabel = roleLabel[me.activeContext.role] ?? me.activeContext.role
  const schoolName = me.contexts.find(
    (item) => item.schoolId === me.activeContext.schoolId && item.role === me.activeContext.role,
  )?.schoolName
  return (
    <div className={styles.frame}>
      <aside className={styles.sidebar}>
        <p className={styles.brand}>Học cùng nhau</p>
        <p className={styles.muted}>{me.displayName}</p>
        {me.contexts.length > 1 ? (
          <label>
            Ngữ cảnh
            <select
              className={styles.select}
              aria-label="Ngữ cảnh"
              value={`${me.activeContext.schoolId}:${me.activeContext.role}`}
              onChange={(event) => {
                const [schoolId, role] = event.target.value.split(':')
                if (!schoolId || !role) return
                void switchContext({ schoolId, role }, me.csrfToken).then(async () => {
                  await client.invalidateQueries()
                })
              }}
            >
              {me.contexts.map((item) => (
                <option key={`${item.schoolId}:${item.role}`} value={`${item.schoolId}:${item.role}`}>
                  {roleLabel[item.role] ?? item.role} · {item.schoolName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            void logout(me.csrfToken).then((endSessionUrl) => {
              window.location.assign(endSessionUrl)
            })
          }}
        >
          Đăng xuất
        </button>
      </aside>
      <main className={styles.main}>
        <h1>Ngữ cảnh hiện tại: {activeLabel}{schoolName ? ` tại ${schoolName}` : ''}</h1>
        <p>Chọn việc cần làm sẽ có ở các mốc sau. Phiên này chỉ nằm trên máy chủ.</p>
      </main>
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/login-required', element: <LoginRequired /> },
  { path: '/', loader: rootLoader, element: <Shell /> },
])

const root = document.getElementById('root')
if (!root) throw new Error('Thiếu #root')
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
