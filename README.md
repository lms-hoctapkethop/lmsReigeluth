# Học cùng nhau

Website học tập cho một lớp học phần Tin học 10. Học sinh lập kế hoạch, học bài rẽ nhánh `if–else`, nộp bài và nhận biên nhận. Giáo viên công bố nhận xét. Phụ huynh xem hồ sơ của con và ghi nhận đồng hành.

Dữ liệu nằm trong `data/db.json` trên máy đang chạy. Tải lại trang không xóa bài đã nộp.

## Chạy local

```bash
npm install
npm run dev
```

Mở http://127.0.0.1:43123

## Tài khoản minh họa

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Học sinh Lê An | an.le@gds.edu.vn | AnHoc2026 |
| Giáo viên Nguyễn Hà | ha.nguyen@gds.edu.vn | HaDay2026 |
| Phụ huynh Trần Mai | mai.tran@gds.edu.vn | MaiNha2026 |
| Quản trị trường | admin@gds.edu.vn | QuanTri2026 |

Bốn tài khoản dùng chung một trường. Học sinh không xem hàng chờ chấm. Phụ huynh không nộp bài thay con. Quản trị không mở bài làm.

## Phạm vi lát cắt này

Đã có: đăng nhập theo vai trò, kế hoạch tuần, bài học, bản nháp, nộp bài có mã biên nhận, trắc nghiệm chấm ở server, nhận xét giáo viên, hồ sơ mục tiêu, ghi nhận gia đình, thông báo, soạn và phát hành nội dung, quản trị tài khoản, tổ chức học, liên kết gia đình và nhật ký.

Chưa có: Keycloak, PostgreSQL, upload tệp, Docker production. Đó là các giai đoạn sau trong đặc tả kiến trúc.
