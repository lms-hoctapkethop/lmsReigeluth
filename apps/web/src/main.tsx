import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, Outlet, redirect, RouterProvider, useLoaderData, useRouteLoaderData } from 'react-router'
import type { Me } from '@hcn/contracts'
import { Accounts, AdminHome, Guardians, OfferingAdmin, TeachHome } from './admin.tsx'
import { Inbox, NotificationBell } from './review/inbox.tsx'
import { GuardianChild, GuardianHome } from './review/portal.tsx'
import { LearnerRecord } from './review/records.tsx'
import { ReviewDesk } from './review/desk.tsx'
import { ReviewKeysHelp } from './review/help.tsx'
import { ReviewQueue } from './review/queue.tsx'
import { CurriculumHome } from './curriculum.tsx'
import { readJson } from './admin-api.ts'
import { fetchMe, logout, switchContext } from './api.ts'
import { roleLabel } from './labels.ts'
import adminStyles from './admin.module.css'
import styles from './shell.module.css'
import './ui/tokens.css'

const StudioList = lazy(() => import('./studio/list.tsx'))
const StudioEditor = lazy(() => import('./studio/editor.tsx'))
const StudioPreview = lazy(() => import('./studio/preview.tsx'))
const LearnToday = lazy(() => import('./learn/today.tsx').then((mod) => ({ default: mod.LearnToday })))
const LearnClass = lazy(() => import('./learn/class.tsx').then((mod) => ({ default: mod.LearnClass })))
const LearnRelease = lazy(() => import('./learn/release.tsx').then((mod) => ({ default: mod.LearnRelease })))
const LearnTask = lazy(() => import('./learn/task.tsx').then((mod) => ({ default: mod.LearnTask })))
const AssignWork = lazy(() => import('./teach/assign.tsx').then((mod) => ({ default: mod.AssignWork })))

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
  const access = useQuery({
    queryKey: ['curriculum-access', me.userId, me.activeContext.role],
    queryFn: () => readJson<{ propose: boolean; review: boolean }>('/api/v1/curriculum/access'),
  })
  const showCurriculum = Boolean(access.data?.propose || access.data?.review)
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
                void switchContext({ schoolId, role }, me.csrfToken).then(async (next) => {
                  client.setQueryData(['me'], next)
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
        <nav className={adminStyles.nav} aria-label="Mục chính">
          {me.activeContext.role === 'admin' ? (
            <>
              <Link to="/quan-tri">Quản trị</Link>
              <Link to="/quan-tri/tai-khoan">Tài khoản</Link>
              <Link to="/quan-tri/phu-huynh">Phụ huynh</Link>
            </>
          ) : null}
          {showCurriculum ? <Link to="/chuyen-mon">Chuyên môn</Link> : null}
          {me.activeContext.role === 'teacher' ? <Link to="/day">Lớp đang dạy</Link> : null}
          {me.activeContext.role === 'teacher' ? <Link to="/day/soan">Soạn bài</Link> : null}
          {me.activeContext.role === 'student' ? <Link to="/hoc">Lớp của em</Link> : null}
          {me.activeContext.role === 'guardian' ? <Link to="/phu-huynh">Con của tôi</Link> : null}
          <NotificationBell />
        </nav>
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
        <Outlet />
      </main>
    </div>
  )
}

function Home() {
  const initial = useRouteLoaderData('shell') as Me
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, initialData: initial })
  const me = meQuery.data ?? initial
  const activeLabel = roleLabel[me.activeContext.role] ?? me.activeContext.role
  const schoolName = me.contexts.find(
    (item) => item.schoolId === me.activeContext.schoolId && item.role === me.activeContext.role,
  )?.schoolName
  return <h1>Ngữ cảnh hiện tại: {activeLabel}{schoolName ? ` tại ${schoolName}` : ''}</h1>
}

function CurriculumPage() {
  const me = useRouteLoaderData('shell') as Me
  return <CurriculumHome me={me} />
}

function AdminPage({ page }: { page: 'home' | 'offering' | 'accounts' | 'guardians' }) {
  const me = useRouteLoaderData('shell') as Me
  if (page === 'home') return <AdminHome me={me} />
  if (page === 'offering') return <OfferingAdmin me={me} />
  if (page === 'accounts') return <Accounts me={me} />
  return <Guardians me={me} />
}

const router = createBrowserRouter([
  { path: '/login-required', element: <LoginRequired /> },
  {
    id: 'shell',
    path: '/',
    loader: rootLoader,
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'quan-tri', element: <AdminPage page="home" /> },
      { path: 'quan-tri/lop/:offeringId', element: <AdminPage page="offering" /> },
      { path: 'quan-tri/tai-khoan', element: <AdminPage page="accounts" /> },
      { path: 'quan-tri/phu-huynh', element: <AdminPage page="guardians" /> },
      { path: 'chuyen-mon', element: <CurriculumPage /> },
      { path: 'day', element: <TeachHome /> },
      { path: 'day/lop/:id/giao', element: <Suspense fallback={<p>Đang mở giao bài</p>}><AssignWork /></Suspense> },
      { path: 'day/soan', element: <Suspense fallback={<p>Đang mở studio</p>}><StudioList /></Suspense> },
      { path: 'day/soan/:moduleId', element: <Suspense fallback={<p>Đang mở studio</p>}><StudioEditor /></Suspense> },
      { path: 'day/soan/:moduleId/xem-truoc', element: <Suspense fallback={<p>Đang mở studio</p>}><StudioPreview /></Suspense> },
      { path: 'day/cham/phim', element: <ReviewKeysHelp /> },
      { path: 'day/cham/bai/:submissionVersionId', element: <ReviewDesk /> },
      { path: 'day/cham/:offeringId', element: <ReviewQueue /> },
      { path: 'hoc', element: <Suspense fallback={<p>Đang tải việc cần làm</p>}><LearnToday /></Suspense> },
      { path: 'hoc/lop/:id', element: <Suspense fallback={<p>Đang tải lớp</p>}><LearnClass /></Suspense> },
      { path: 'hoc/bai/:releaseId', element: <Suspense fallback={<p>Đang tải bài</p>}><LearnRelease /></Suspense> },
      { path: 'hoc/bai/:releaseId/muc/:itemId', element: <Suspense fallback={<p>Đang tải nhiệm vụ</p>}><LearnTask /></Suspense> },
      { path: 'hoc/ho-so/:offeringId', element: <LearnerRecord /> },
      { path: 'gia-dinh', element: <GuardianHome /> },
      { path: 'gia-dinh/con/:learnerId', element: <GuardianChild /> },
      { path: 'phu-huynh', element: <GuardianHome /> },
      { path: 'phu-huynh/con/:learnerId', element: <GuardianChild /> },
      { path: 'thong-bao', element: <Inbox /> },
    ],
  },
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
