# 07 · Giao diện

SPA React. Giữ nhận diện "Học cùng nhau" từ bản mẫu và bộ 2.1: màu chính `#5150DF`, nền `#F6F7FB`, chữ `#22263B`, sidebar khoảng 245 px trên desktop, thẻ trắng. Prototype trên claude.ai (bổ sung 2.2) là tham chiếu bố cục cho các màn Tổng quan HS, Bài học, Theo dõi lớp, Soạn bài, Bàn chấm, Phụ huynh.

## 1 Token thiết kế (`apps/web/src/ui/tokens.css`)

```css
:root {
  --c-accent: #5150DF; --c-accent-soft: #ECECFD; --c-on-accent: #FFFFFF;
  --c-bg: #F6F7FB; --c-surface: #FFFFFF; --c-ink: #22263B; --c-muted: #5E6280; --c-line: #E3E5F0;
  --c-needs: #C4402F; --c-needs-soft: #FBE7E3;      /* Cần hỗ trợ */
  --c-dev: #B7791F;   --c-dev-soft: #FBF1DC;        /* Đang phát triển */
  --c-strong: #2F855A; --c-strong-soft: #E2F4EA;    /* Có bằng chứng tốt */
  --c-none: #8A8FA8;  --c-none-soft: #EEEFF5;       /* Chưa đủ bằng chứng (kèm gạch chéo) */
  --font-ui: "Be Vietnam Pro", system-ui, sans-serif;
  --font-code: "JetBrains Mono", ui-monospace, monospace;
  --fs-body: 16px; --fs-small: 14px; --fs-label: 13px; --fs-h1: 24px; --fs-h2: 18px;
  --radius: 10px; --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
}
@media (prefers-color-scheme: dark) { :root {
  --c-accent: #8C8BFF; --c-accent-soft: #26264A; --c-on-accent: #12131C;
  --c-bg: #12131C; --c-surface: #1B1D2A; --c-ink: #E7E8F2; --c-muted: #A2A6C0; --c-line: #2C2F42;
  --c-needs: #F2826F; --c-needs-soft: #3A1F1C; --c-dev: #E7B55A; --c-dev-soft: #3A2F17;
  --c-strong: #6FCF97; --c-strong-soft: #18332A; --c-none: #8E93AE; --c-none-soft: #262839;
} }
```

Trạng thái luôn có **chữ** bên cạnh màu. Nhãn nhỏ nhất 13 px; nội dung chính 16 px.

## 2 Route

| Đường dẫn | Vai trò | Màn hình | API chính |
|---|---|---|---|
| `/` | mọi | Chuyển theo ngữ cảnh | `GET /me` |
| `/login-required` | — | Chưa đăng nhập hoặc chưa được cấp quyền | — |
| `/hoc` | HS | Hôm nay: việc cần làm, phản hồi mới | `GET /me/today` |
| `/hoc/lop/:offeringId` | HS | Danh sách module đã giao | `GET /offerings/{id}/releases` |
| `/hoc/bai/:releaseId` | HS | Module: dàn mục, tiêu chí, tiến độ | `GET /module-releases/{id}` |
| `/hoc/bai/:releaseId/muc/:itemId` | HS | Trang học liệu, nhiệm vụ (soạn/nộp), quiz | draft, submit, attempts |
| `/hoc/ho-so/:offeringId` | HS | Hồ sơ theo YCCĐ: ba lớp số liệu | `GET /learners/{me}/records`, `/needs` |
| `/day` | GV | Lớp đang dạy | `GET /offerings` |
| `/day/lop/:offeringId` | GV | Theo dõi lớp: bản đồ nhiệt, hàng chờ, cảnh báo (M10) | heatmap, review-queue |
| `/day/lop/:offeringId/giao` | GV | Giao module (chọn version, lịch) | `POST path-releases` |
| `/day/soan` | GV | Module của tôi | — |
| `/day/soan/:moduleId` | GV | Studio: dàn mục, soạn, câu hỏi, rubric, độ phủ, publish | draft, validate, versions |
| `/day/cham/:offeringId` | GV | Hàng chờ chấm | review-queue |
| `/day/cham/bai/:submissionVersionId` | GV | Bàn chấm | openReview, save, publish |
| `/day/hoc-sinh/:learnerId?offering=` | GV | Hồ sơ một HS | records, needs |
| `/gia-dinh` | PH | Chọn con | `GET /me/children` |
| `/gia-dinh/con/:learnerId` | PH | Tổng quan con, phản hồi đã công bố, đồng hành | overview, family-supports |
| `/quan-tri` | admin | Năm học, lớp, offering, phân công, ghi danh | admin/* |
| `/quan-tri/tai-khoan` | admin | Nhập CSV, phiếu mật khẩu tạm | `POST admin/users/import` |
| `/quan-tri/phu-huynh` | admin | Liên kết chờ xác minh | admin/guardian-links |
| `/chuyen-mon` | curriculum reviewer | Hàng đợi YCCĐ, KC, cạnh cần duyệt | curriculum/* |
| `/thong-bao` | mọi | Hộp thông báo | notifications |

`learnerId`, `offeringId` trong URL không tạo quyền; API kiểm lại. Truy cập không được phép hiện trang 404 chung.

## 3 Màn hình trọng tâm

### 3.1 Nhiệm vụ của HS (`/hoc/bai/:releaseId/muc/:itemId`, assignment)

Bố cục: tiêu đề và hạn nộp (giờ Việt Nam, đếm ngược khi còn dưới 48 giờ) → mô tả nhiệm vụ → **tiêu chí rubric hiển thị trước khi làm** → vùng làm bài → tệp đính kèm → phản hồi đã công bố → lịch sử phiên bản.

- Vùng làm bài: loại `code` dùng CodeMirror 6 (chế độ Python/SQL/HTML/CSS, chỉ tô màu, không chạy) + bảng ca thử (đầu vào, mong đợi, thực tế, ghi chú); loại `text` là textarea; loại `rich` là editor giới hạn khối `hcn-rich/1`.
- Tự lưu mỗi 10 giây khi có thay đổi và khi rời trang; hiển thị "Đang lưu…", "Đã lưu lúc 14:03" (chỉ khi 200), "Chưa lưu được — thử lại" (lỗi mạng, giữ nội dung trong bộ nhớ). Mất mạng lâu: lưu bản sao trong `sessionStorage` theo `userId:releaseId:itemId` và xóa khi đăng xuất.
- 409 khi lưu (sửa ở tab khác): hộp thoại cho chọn "Tải bản trên máy chủ" hoặc "Giữ bản này và ghi đè" (gửi lại với revision mới).
- Nút "Nộp bài": hộp thoại xác nhận nêu phiên bản sẽ là v(n+1) và tệp kèm theo → gửi `Idempotency-Key` sinh lúc mở hộp thoại → hiển thị biên nhận (mã phiên bản, giờ server, "nộp muộn" nếu có).
- 423 tệp chưa quét: "Tệp đang được kiểm tra an toàn, thử lại sau ít giây"; tự thử lại 3 lần mỗi 3 giây.

### 3.2 Quiz của HS

- Một câu một màn hình trên điện thoại; danh sách câu trên desktop.
- Practice: sau khi chọn, hiện đúng/sai ngay; sai và có lỗi hiểu sai → khung phản hồi nêu lỗi; nút "Xem gợi ý 1/2/3"; không hiện đáp án khi chưa đúng.
- Diagnostic/exit ticket: không hiện đúng sai tới khi nộp (trừ cấu hình); nút "Em chưa học phần này" (ghi thiếu dữ liệu, B05).
- Toán 7 (THCS): không có ô chat; chỉ nút hỏi có cấu trúc (B13).
- Câu số: bàn phím số trên điện thoại (`inputmode="decimal"`); lỗi 422 hiện dưới ô: "Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5".
- Không đồng hồ đếm giờ, không bảng xếp hạng.

### 3.3 Studio (`/day/soan/:moduleId`)

Ba vùng: dàn mục (kéo thả **và** nút lên/xuống), vùng soạn theo loại mục, bảng bên phải theo ngữ cảnh (YCCĐ/KC, câu hỏi, rubric, độ phủ). Trên màn hình < 1024 px ba vùng thành ba tab.

- Chọn YCCĐ từ danh sách theo môn, lớp (mã 791 + nội dung, nhãn "chưa đối chiếu" nếu `review_status=unverified`).
- Soạn câu hỏi: đề, phương án, đáp án, KC observable (bắt buộc), KC required, Bloom, gợi ý (tối đa 3), lỗi hiểu sai cho từng phương án sai, nhóm biến thể.
- Rubric: tiêu chí, KC (khuyến nghị), ba mức mô tả.
- Nút "Kiểm tra": gọi validate, hiển thị ma trận độ phủ (hàng YCCĐ + Bloom, cột câu hỏi/tiêu chí) và danh sách V01–V08 với liên kết tới chỗ cần sửa.
- Nút "Phát hành phiên bản": khóa khi có lỗi chặn; yêu cầu nhập lý do cho từng cảnh báo `caution`.
- Tự lưu như 3.1; xung đột revision khi hai GV cùng sửa → hộp thoại so sánh đơn giản (bản của tôi / bản trên máy chủ).
- Xem trước dưới góc nhìn HS (không sinh tiến độ, P1a-07).

### 3.4 Bàn chấm

Hai cột: trái là bài nộp (mã có số dòng, bảng ca thử, tệp, lời giải thích của HS, bộ chọn phiên bản); phải là rubric (4 mức mỗi tiêu chí, kể cả "Chưa thể hiện"), nhận xét, và mục "Ghi quyết định mức đạt" **mặc định tắt** cho từng YCCĐ, mỗi quyết định cần lý do.

- Nếu có phiên bản mới hơn: dải cảnh báo "HS đã nộp v3 lúc …" với nút "Mở v3"; nút công bố của v2 bị khóa (A06).
- "Lưu nháp" và "Công bố" là hai nút riêng; công bố có hộp xác nhận nêu HS và PH sẽ thấy gì.
- Phím tắt: `1–4` chọn mức cho tiêu chí đang focus, `j/k` chuyển tiêu chí, `n` sang bài tiếp theo trong hàng chờ (có hiển thị trợ giúp phím tắt).

### 3.5 Theo dõi lớp (GV)

- Bản đồ nhiệt HS × KC (cột theo thứ tự tiên quyết), ô có chữ viết tắt trạng thái và màu, `title` đầy đủ; bật "Hiện giá trị số" chỉ trong màn GV.
- Nhóm theo hổng gốc (docs/06 mục 5), nút "Giao nhiệm vụ bổ trợ cho nhóm" (M10).
- Hàng chờ chấm với số bài, số bài muộn.

### 3.6 Phụ huynh

Chọn con → tiến độ hoạt động (thanh), YCCĐ đã được xác nhận / tổng, phản hồi đã công bố (không nội dung bài), việc gia đình có thể hỗ trợ, nút "Tôi sẽ đồng hành cùng con" / "Hủy". Không có ước lượng, không so sánh với bạn.

## 4 Trạng thái bắt buộc cho mọi màn hình

| Trạng thái | Hiển thị |
|---|---|
| Đang tải | Skeleton đúng bố cục, không spinner toàn trang sau 300 ms đầu |
| Rỗng | Câu giải thích + hành động tiếp theo (ví dụ "Chưa có bài được giao. Khi thầy cô giao bài, bài sẽ xuất hiện ở đây.") |
| 401 | Chuyển `/auth/login?returnTo=` |
| 403/404 | Trang "Không tìm thấy hoặc bạn không có quyền xem" + về trang chủ |
| Lỗi mạng | Dải báo lỗi có nút "Thử lại"; giữ dữ liệu đang nhập |
| 409 | Hộp thoại giải quyết xung đột theo ngữ cảnh |
| 422 | Lỗi cạnh trường cụ thể; tóm tắt lỗi ở đầu biểu mẫu, focus vào lỗi đầu |
| Thành công | Toast mô tả đúng việc đã xảy ra ("Đã nộp bài lúc 14:03") |

## 5 Khả năng tiếp cận (mục tiêu kiểm thử NFR-06)

- Toàn bộ luồng HS (mở bài → làm → lưu → nộp → đọc phản hồi) làm được bằng bàn phím.
- Focus nhìn thấy (2 px accent), thứ tự focus theo DOM; modal giữ focus và trả focus khi đóng.
- Kéo thả trong Studio có nút lên/xuống thay thế.
- Mọi ảnh trong học liệu có alt bắt buộc (Studio chặn nếu thiếu).
- Vùng chạm ≥ 44×44 px trên màn hình cảm ứng.
- Zoom 200% và chiều rộng 360 px không mất chức năng, không cuộn ngang trang.
- `aria-live="polite"` cho trạng thái lưu và kết quả nộp.
- Tôn trọng `prefers-reduced-motion`.

## 6 Hiệu năng

- Tách route (`lazy()`) theo vai trò; route HS không tải Studio, CodeMirror chỉ tải khi mở nhiệm vụ code.
- JS nén < 250 KB cho route `/hoc` (NFR-08). Font tự host trong `public/fonts` (không gọi Google Fonts ở production, INV-14).
- TanStack Query `staleTime` 30 giây cho danh sách, 0 cho dữ liệu vừa ghi (invalidate sau mutation).

## 7 Chuỗi hiển thị

Tất cả trong `apps/web/src/i18n/vi.ts`, nhóm theo màn hình. Ngày giờ định dạng `HH:mm dd/MM/yyyy` theo `Asia/Ho_Chi_Minh`. Số thập phân dùng dấu phẩy khi hiển thị.
