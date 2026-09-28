export const DEMO_ACCOUNTS = [
  {
    email: "an.le@gds.edu.vn",
    password: "AnHoc2026",
    name: "Lê An",
    role: "student" as const,
    hint: "Học sinh lớp 10A1",
  },
  {
    email: "ha.nguyen@gds.edu.vn",
    password: "HaDay2026",
    name: "Nguyễn Hà",
    role: "teacher" as const,
    hint: "Giáo viên Tin học 10",
  },
  {
    email: "mai.tran@gds.edu.vn",
    password: "MaiNha2026",
    name: "Trần Mai",
    role: "guardian" as const,
    hint: "Phụ huynh của Lê An",
  },
  {
    email: "admin@gds.edu.vn",
    password: "QuanTri2026",
    name: "Quản trị trường",
    role: "admin" as const,
    hint: "Quản trị nhà trường",
  },
]
