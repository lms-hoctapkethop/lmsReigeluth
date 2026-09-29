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

## Adapter JSON

Mọi lệnh ghi nghiệp vụ đi qua một vùng khóa đọc–kiểm–ghi. Lệnh gửi `expectedRevision` lấy từ lần tải trang. Đúng revision thì dữ liệu, số revision mới và biên nhận được ghi cùng một lần, bằng file tạm rồi đổi tên. Hai lệnh khác mã gửi lại nhưng cùng revision: một lệnh được ghi, lệnh kia nhận HTTP 409 mã `REVISION_CONFLICT`. Gửi lại cùng mã và cùng nội dung nhận lại biên nhận cũ. Cùng mã nhưng khác nội dung bị từ chối mã `IDEMPOTENCY_MISMATCH`.

Lệch `draft.version` khi lưu nháp hoặc nộp bài thực hành vẫn là HTTP 409, với câu thông báo cũ, và không dùng mã `REVISION_CONFLICT`.

Khóa đang nằm trong bộ nhớ của một tiến trình, kèm file `data/writer.lock` ghi PID. Chỉ chạy một `next dev` hoặc một `next start` cho cùng một file dữ liệu. Tiến trình thứ hai nhận HTTP 503 mã `SINGLE_WRITER`.

Giao lớp (`classDeliveryEnabled`) mặc định tắt. `POST /api/modules` với `action: "deliver"` từ chối mã `CLASS_DELIVERY_OFF` và không tự bật cờ. Kho 34 bài giữ ở dạng biên soạn, chưa nhập vào app. Tuần lớp giữ `28/09 – 04/10/2026`.

```bash
npm test
```

Lệnh này chạy trên thư mục tạm (`HCN_DB_PATH`), không ghi `data/db.json`. Kết quả từng ca nằm trong `docs/LICH_SU_CODE.md`. Ca chưa chạy giữ `NOT_RUN`.
