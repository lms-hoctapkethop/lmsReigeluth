import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Me } from '@hcn/contracts'
import { postJson, readJson, type AdminClass, type Course, type GuardianLink, type ImportResult, type Offering, type SchoolUser, type Year } from './admin-api.ts'
import styles from './admin.module.css'

function useResource<T>(path: string): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    readJson<T>(path)
      .then((value) => {
        if (live) setData(value)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : 'Không tải được dữ liệu')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [path, tick])
  return { data, error, loading, reload: () => setTick((value) => value + 1) }
}

export function AdminHome({ me }: { me: Me }) {
  const years = useResource<Year[]>('/api/v1/admin/academic-years')
  const classes = useResource<AdminClass[]>('/api/v1/admin/classes')
  const courses = useResource<Course[]>('/api/v1/admin/courses')
  const offerings = useResource<Offering[]>('/api/v1/offerings')
  const [message, setMessage] = useState('')
  const [yearCode, setYearCode] = useState('2027-2028')
  const [classCode, setClassCode] = useState('')
  const [courseTitle, setCourseTitle] = useState('')
  const [offeringCode, setOfferingCode] = useState('')
  const [offeringTitle, setOfferingTitle] = useState('')
  const [courseId, setCourseId] = useState('')
  const [yearId, setYearId] = useState('')
  useEffect(() => {
    if (!yearId && years.data?.[0]) setYearId(years.data[0].id)
  }, [yearId, years.data])
  useEffect(() => {
    if (!courseId && courses.data?.[0]) setCourseId(courses.data[0].id)
  }, [courseId, courses.data])

  if (me.activeContext.role !== 'admin') return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  return (
    <section>
      <h1>Tổ chức nhà trường</h1>
      {message ? <p role="status">{message}</p> : null}
      <div className={styles.grid}>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault()
            void postJson('/api/v1/admin/academic-years', me.csrfToken, { code: yearCode, startsOn: '2027-09-01', endsOn: '2028-05-31' })
              .then(() => {
                setMessage(`Đã tạo năm học ${yearCode}.`)
                years.reload()
              })
              .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không tạo được năm học'))
          }}
        >
          <h2>Năm học</h2>
          {years.loading ? <p>Đang tải năm học.</p> : null}
          {years.error ? <p>{years.error}</p> : null}
          {!years.loading && years.data?.length === 0 ? <p>Chưa có năm học. Hãy tạo năm học trước khi mở lớp.</p> : null}
          <ul>
            {years.data?.map((item) => (
              <li key={item.id}>{item.code}</li>
            ))}
          </ul>
          <label>
            Mã năm học
            <input value={yearCode} onChange={(event) => setYearCode(event.target.value)} />
          </label>
          <button type="submit">Tạo năm học</button>
        </form>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault()
            const academicYearId = yearId || years.data?.[0]?.id
            if (!academicYearId) return
            void postJson('/api/v1/admin/classes', me.csrfToken, { academicYearId, grade: 10, code: classCode })
              .then(() => {
                setMessage(`Đã tạo lớp ${classCode}.`)
                setClassCode('')
                classes.reload()
              })
              .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không tạo được lớp'))
          }}
        >
          <h2>Lớp</h2>
          {classes.loading ? <p>Đang tải lớp.</p> : null}
          {!classes.loading && classes.data?.length === 0 ? <p>Chưa có lớp hành chính.</p> : null}
          <ul>
            {classes.data?.map((item) => (
              <li key={item.id}>{item.code}</li>
            ))}
          </ul>
          <label>
            Mã lớp
            <input value={classCode} onChange={(event) => setClassCode(event.target.value)} required />
          </label>
          <button type="submit">Tạo lớp</button>
        </form>
        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault()
            void postJson('/api/v1/admin/courses', me.csrfToken, { subjectCode: '1401', grade: 10, title: courseTitle })
              .then(() => {
                setMessage(`Đã tạo môn ${courseTitle}.`)
                setCourseTitle('')
                courses.reload()
              })
              .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không tạo được môn'))
          }}
        >
          <h2>Môn học</h2>
          {courses.loading ? <p>Đang tải môn học.</p> : null}
          {!courses.loading && courses.data?.length === 0 ? <p>Chưa có môn học.</p> : null}
          <ul>
            {courses.data?.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
          <label>
            Tên môn
            <input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} required />
          </label>
          <button type="submit">Tạo môn học</button>
        </form>
      </div>
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault()
          const chosenCourse = courseId || courses.data?.[0]?.id
          const chosenYear = yearId || years.data?.[0]?.id
          if (!chosenCourse || !chosenYear) return
          void postJson<Offering>('/api/v1/admin/offerings', me.csrfToken, {
            courseId: chosenCourse,
            academicYearId: chosenYear,
            term: 1,
            code: offeringCode.toUpperCase(),
            title: offeringTitle,
          })
            .then(() => {
              setMessage(`Đã tạo lớp học phần ${offeringTitle}.`)
              setOfferingCode('')
              setOfferingTitle('')
              offerings.reload()
            })
            .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không tạo được lớp học phần'))
        }}
      >
        <h2>Lớp học phần</h2>
        {offerings.loading ? <p>Đang tải lớp học phần.</p> : null}
        {offerings.error ? <p>{offerings.error} <button type="button" onClick={() => offerings.reload()}>Thử lại</button></p> : null}
        {!offerings.loading && offerings.data?.length === 0 ? <p>Chưa có lớp học phần. Tạo một lớp để phân công giáo viên.</p> : null}
        <ul>
          {offerings.data?.map((item) => (
            <li key={item.id}>
              <Link to={`/quan-tri/lop/${item.id}`}>{item.title}</Link>
            </li>
          ))}
        </ul>
        <label>
          Môn học
          <select aria-label="Môn học" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            {(courses.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <label>
          Năm học
          <select aria-label="Năm học" value={yearId} onChange={(event) => setYearId(event.target.value)}>
            {(years.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.code}</option>
            ))}
          </select>
        </label>
        <label>
          Mã
          <input aria-label="Mã" value={offeringCode} onChange={(event) => setOfferingCode(event.target.value)} required />
        </label>
        <label>
          Tên
          <input aria-label="Tên" value={offeringTitle} onChange={(event) => setOfferingTitle(event.target.value)} required />
        </label>
        <button type="submit">Tạo lớp học phần</button>
      </form>
    </section>
  )
}

type OfferingDetail = {
  id: string
  title: string
  teachers: { id: string; teacherId: string; displayName: string; capabilities: string[] }[]
  learners: { id: string; displayName: string; status: string }[]
}

export function OfferingAdmin({ me }: { me: Me }) {
  const params = useParams()
  const offeringId = params.offeringId ?? ''
  const detail = useResource<OfferingDetail>(`/api/v1/admin/offerings/${offeringId}`)
  const teachers = useResource<{ items: SchoolUser[] }>('/api/v1/admin/users?role=teacher')
  const classes = useResource<AdminClass[]>('/api/v1/admin/classes')
  const [teacherId, setTeacherId] = useState('')
  const [caps, setCaps] = useState<string[]>(['teach'])
  const [classId, setClassId] = useState('')
  const [learners, setLearners] = useState<{ id: string; displayName: string }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [message, setMessage] = useState('')
  if (me.activeContext.role !== 'admin') return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  return (
    <section>
      <p><Link to="/quan-tri">Quay lại tổ chức</Link></p>
      <h1>{detail.data?.title ?? 'Lớp học phần'}</h1>
      {detail.loading ? <p>Đang tải lớp học phần.</p> : null}
      {detail.error ? <p>{detail.error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <h2>Giáo viên</h2>
      <ul>
        {detail.data?.teachers.map((item) => (
          <li key={item.id}>{item.displayName} · {item.capabilities.join(', ')}</li>
        ))}
      </ul>
      {detail.data && detail.data.teachers.length === 0 ? <p>Chưa phân công giáo viên.</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void postJson(`/api/v1/admin/offerings/${offeringId}/teachers`, me.csrfToken, { teacherId, capabilities: caps })
            .then(() => {
              setMessage('Đã phân công giáo viên.')
              detail.reload()
            })
            .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không phân công được'))
        }}
      >
        <label>
          Giáo viên
          <select aria-label="Giáo viên" value={teacherId} onChange={(event) => setTeacherId(event.target.value)} required>
            <option value="">Chọn giáo viên</option>
            {teachers.data?.items.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </label>
        {['teach', 'author', 'release', 'review', 'view'].map((cap) => (
          <label key={cap}>
            <input
              type="checkbox"
              checked={caps.includes(cap)}
              onChange={(event) => setCaps((current) => (event.target.checked ? [...current, cap] : current.filter((item) => item !== cap)))}
            />
            {cap}
          </label>
        ))}
        <button type="submit">Phân công</button>
      </form>
      <h2>Học sinh</h2>
      <ul>
        {detail.data?.learners.map((item) => (
          <li key={item.id}>{item.displayName} · {item.status === 'active' ? 'Đang học' : 'Đã thôi'}</li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void postJson(`/api/v1/admin/offerings/${offeringId}/enrollments`, me.csrfToken, { learnerIds: picked })
            .then(() => {
              setMessage('Đã ghi danh học sinh.')
              detail.reload()
            })
            .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Không ghi danh được'))
        }}
      >
        <label>
          Lớp
          <select
            aria-label="Lớp"
            value={classId}
            onChange={(event) => {
              const next = event.target.value
              setClassId(next)
              setPicked([])
              if (!next) {
                setLearners([])
                return
              }
              void readJson<{ id: string; displayName: string }[]>(`/api/v1/admin/classes/${next}/learners`).then(setLearners)
            }}
          >
            <option value="">Chọn lớp</option>
            {classes.data?.map((item) => (
              <option key={item.id} value={item.id}>{item.code}</option>
            ))}
          </select>
        </label>
        {learners.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={picked.includes(item.id)}
              onChange={(event) => setPicked((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))}
            />
            {item.displayName}
          </label>
        ))}
        <button type="submit" disabled={picked.length === 0}>Ghi danh</button>
      </form>
    </section>
  )
}

export function Accounts({ me }: { me: Me }) {
  const [query, setQuery] = useState('')
  const users = useResource<{ items: SchoolUser[] }>(`/api/v1/admin/users?q=${encodeURIComponent(query)}`)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<{ id: string; action: 'lock' | 'unlock' } | null>(null)
  const [slips, setSlips] = useState<ImportResult | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => () => setSlips(null), [])
  if (me.activeContext.role !== 'admin') return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  return (
    <section>
      <h1>Tài khoản</h1>
      <label>
        Tìm người dùng
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {users.loading ? <p>Đang tải danh sách.</p> : null}
      {users.error ? <p>{users.error} <button type="button" onClick={() => users.reload()}>Thử lại</button></p> : null}
      {!users.loading && users.data?.items.length === 0 ? <p>Không có người dùng khớp từ khóa.</p> : null}
      <ul>
        {users.data?.items.map((item) => (
          <li key={item.id}>
            {item.displayName} · {item.status === 'locked' ? 'Đang khóa' : 'Đang mở'} · {item.roles.join(', ')}
            <button type="button" onClick={() => { setPending({ id: item.id, action: item.status === 'locked' ? 'unlock' : 'lock' }); setReason('') }}>
              {item.status === 'locked' ? 'Mở khóa' : 'Khóa'}
            </button>
          </li>
        ))}
      </ul>
      {pending ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void postJson(`/api/v1/admin/users/${pending.id}/${pending.action === 'lock' ? 'lock' : 'unlock'}`, me.csrfToken, { reason })
              .then(() => {
                setPending(null)
                setMessage(pending.action === 'lock' ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.')
                users.reload()
              })
              .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không cập nhật được'))
          }}
        >
          <h2>{pending.action === 'lock' ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}</h2>
          <label>
            Lý do
            <input value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} />
          </label>
          <button type="submit">Xác nhận</button>
          <button type="button" onClick={() => setPending(null)}>Hủy</button>
        </form>
      ) : null}
      <h2>Nhập CSV</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const input = event.currentTarget.elements.namedItem('file')
          const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined
          if (!file) return
          const data = new FormData()
          data.set('file', file)
          void fetch('/api/v1/admin/users/import', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'x-csrf-token': me.csrfToken, 'idempotency-key': crypto.randomUUID() },
            body: data,
          })
            .then(async (response) => {
              const body = (await response.json()) as ImportResult & { error?: { message?: string } }
              if (!response.ok) throw new Error(body.error?.message ?? 'Không nhập được tệp')
              setSlips(body)
              users.reload()
            })
            .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không nhập được tệp'))
        }}
      >
        <label>
          Tệp CSV
          <input name="file" type="file" accept=".csv,text/csv" required />
        </label>
        <button type="submit">Tải lên</button>
      </form>
      {slips?.errors.length ? (
        <ul>
          {slips.errors.map((item) => (
            <li key={`${item.row}-${item.code}`}>Dòng {item.row}: {item.message}</li>
          ))}
        </ul>
      ) : null}
      {slips?.passwordsRedacted ? <p>Mật khẩu tạm không còn trên máy chủ. Hãy đặt lại từng tài khoản.</p> : null}
      {slips && !slips.passwordsRedacted && slips.created.some((item) => item.temporaryPassword) ? (
        <div>
          <button type="button" onClick={() => window.print()}>In phiếu</button>
          <div className={styles.slips}>
            {slips.created.filter((item) => item.temporaryPassword).map((item) => (
              <article key={item.userId} className={styles.slip}>
                <h2>Phiếu tài khoản</h2>
                <p>Tên đăng nhập: {item.username}</p>
                <p>Mật khẩu tạm: {item.temporaryPassword}</p>
                <p>Đổi mật khẩu ngay lần đăng nhập đầu.</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}

export function Guardians({ me }: { me: Me }) {
  const [status, setStatus] = useState('pending')
  const links = useResource<GuardianLink[]>(`/api/v1/admin/guardian-links?status=${status}`)
  const [reason, setReason] = useState('')
  const [revokeId, setRevokeId] = useState('')
  const [message, setMessage] = useState('')
  if (me.activeContext.role !== 'admin') return <p>Không tìm thấy hoặc bạn không có quyền xem.</p>
  return (
    <section>
      <h1>Phụ huynh</h1>
      <label>
        Trạng thái
        <select aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="pending">Chờ xác minh</option>
          <option value="verified">Đã xác minh</option>
          <option value="revoked">Đã thu hồi</option>
        </select>
      </label>
      {links.loading ? <p>Đang tải liên kết.</p> : null}
      {links.error ? <p>{links.error}</p> : null}
      {!links.loading && links.data?.length === 0 ? <p>Không có liên kết ở trạng thái này.</p> : null}
      <ul>
        {links.data?.map((item) => (
          <li key={item.id}>
            {item.guardianName} · {item.learnerName} · {item.status === 'pending' ? 'Chờ xác minh' : item.status === 'verified' ? 'Đã xác minh' : 'Đã thu hồi'}
            {item.status === 'pending' ? (
              <button
                type="button"
                onClick={() => {
                  void postJson(`/api/v1/admin/guardian-links/${item.id}/verify`, me.csrfToken, {})
                    .then(() => {
                      setMessage('Đã xác minh liên kết.')
                      links.reload()
                    })
                    .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không xác minh được'))
                }}
              >
                Xác minh
              </button>
            ) : null}
            {item.status !== 'revoked' ? (
              <button type="button" onClick={() => setRevokeId(item.id)}>Thu hồi</button>
            ) : null}
          </li>
        ))}
      </ul>
      {revokeId ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void postJson(`/api/v1/admin/guardian-links/${revokeId}/revoke`, me.csrfToken, { reason })
              .then(() => {
                setRevokeId('')
                setReason('')
                setMessage('Đã thu hồi liên kết.')
                links.reload()
              })
              .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Không thu hồi được'))
          }}
        >
          <label>
            Lý do thu hồi
            <input value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} />
          </label>
          <button type="submit">Xác nhận thu hồi</button>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  )
}

export function TeachHome() {
  const offerings = useResource<Offering[]>('/api/v1/offerings')
  return (
    <section>
      <h1>Lớp đang dạy</h1>
      {offerings.loading ? <p>Đang tải lớp.</p> : null}
      {!offerings.loading && offerings.data?.length === 0 ? <p>Chưa có lớp được phân công.</p> : null}
      <ul>
        {offerings.data?.map((item) => (
          <li key={item.id}>
            <Link to={`/day/lop/${item.id}/giao`}>{item.title}</Link>
            {' · '}
            <Link to={`/day/cham/${item.id}`}>Chấm bài</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function LearnHome() {
  const offerings = useResource<Offering[]>('/api/v1/offerings')
  return (
    <section>
      <h1>Lớp của em</h1>
      {offerings.loading ? <p>Đang tải lớp.</p> : null}
      {!offerings.loading && offerings.data?.length === 0 ? <p>Chưa có lớp học phần nào được ghi danh.</p> : null}
      <ul>
        {offerings.data?.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </section>
  )
}

export function FamilyHome() {
  const children = useResource<{ learnerId: string; name: string; className: string }[]>('/api/v1/me/children')
  return (
    <section>
      <h1>Con của tôi</h1>
      {children.loading ? <p>Đang tải danh sách con.</p> : null}
      {!children.loading && children.data?.length === 0 ? <p>Chưa có liên kết phụ huynh đã xác minh.</p> : null}
      <ul>
        {children.data?.map((item) => (
          <li key={item.learnerId}>{item.name}{item.className ? ` · lớp ${item.className}` : ''}</li>
        ))}
      </ul>
    </section>
  )
}
