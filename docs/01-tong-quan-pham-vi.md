# 01 · Tổng quan và phạm vi

## 1 Mục tiêu sản phẩm

Học cùng nhau giúp:

- **Giáo viên** soạn module bài học gắn yêu cầu cần đạt (YCCĐ), giao cho lớp môn, chấm theo rubric và công bố phản hồi.
- **Học sinh** biết việc cần làm, làm và nộp bài, luyện tập có gợi ý, đọc phản hồi, xem hồ sơ tiến bộ.
- **Phụ huynh** xem phản hồi đã công bố của đúng con và xác nhận việc đồng hành.
- **Nhà trường** quản lý lớp, môn, phân công, ghi danh, liên kết phụ huynh; truy vết được minh chứng học tập.

Cơ sở sư phạm: bốn chức năng của LMS theo Reigeluth và cộng sự (2008): lưu hồ sơ, lập kế hoạch, hỗ trợ dạy học, đánh giá. Tên sản phẩm là "Học cùng nhau".

## 2 Phạm vi bản 3.0

| Trong phạm vi (code đầy đủ) | Nền dữ liệu, chưa code phần AI | Ngoài phạm vi |
|---|---|---|
| Đăng nhập OIDC, phiên, CSRF | Bảng `observations`, `needs_estimates`, `path_proposals`, `ai_proposals` | Gọi LLM, sinh câu hỏi tự động |
| Trường, năm học, lớp hành chính, môn, lớp môn (offering), phân công, ghi danh, liên kết PH | Hàm R0 thuần + test (docs/06) chạy trong worker | Knowledge tracing R1/R2 |
| YCCĐ (seed 791), KC, cạnh tiên quyết, lỗi hiểu sai, duyệt | API đọc nhu cầu cho GV (chỉ đọc) | Code runner chạy mã HS |
| Module: nháp, 5 loại mục, câu hỏi, rubric, publish version, ma trận độ phủ | | SCORM, LTI, liên thông Canvas |
| Giao module (path release), lịch, học sinh xem và làm | | Thi có hệ quả, giám sát thi |
| Nộp bài có biên nhận, nộp lại, tệp đính kèm quét mã độc | | Video trực tiếp, chat thời gian thực |
| Quiz (chẩn đoán, luyện tập có gợi ý, phiếu ra lớp) chấm phía server | | Ứng dụng di động gốc |
| Bàn chấm rubric, công bố, quyết định mức đạt có lịch sử | | Nhiều trường liên thông dữ liệu |
| Hồ sơ HS, cổng PH, hỗ trợ gia đình, thông báo trong ứng dụng | | |
| Audit, outbox, sao lưu, giám sát | | |

Thử nghiệm đầu: một trường, các lớp môn Tin học 10, 11, 12 và Toán 7, 10.

## 3 Vai trò

| Vai trò | Cách có vai trò | Phạm vi |
|---|---|---|
| `admin` (quản trị trường) | Được cấp trong `school_memberships` | Quản lý tổ chức trong trường; **không** mặc nhiên chấm bài hay sửa kết quả |
| `teacher` | Membership + `teacher_assignments` cho từng offering | Chỉ offering được phân công |
| `student` | Membership + `offering_enrollments` | Chỉ dữ liệu của mình, offering đã ghi danh |
| `guardian` | Membership + `guardian_links` trạng thái `verified` | Chỉ dữ liệu đã công bố của con được liên kết |
| `platform_operator` | Cấu hình hạ tầng, không có trong bảng membership | Không truy cập dữ liệu học tập qua ứng dụng |

Một tài khoản có thể có nhiều vai trò (GV đồng thời là PH). Giao diện cho chọn **ngữ cảnh** trong các vai trò đã có; server kiểm lại quyền ở mọi request.

## 4 Thuật ngữ

| Thuật ngữ | Nghĩa | Tên trong mã |
|---|---|---|
| YCCĐ | Yêu cầu cần đạt của chương trình, định danh theo QĐ 791 | `curriculum_requirement` |
| Mã 791 | `CCMMLL.U1U2x[b]`: chương trình, môn, lớp, đơn vị cấp 1, cấp 2, chữ cái YCCĐ, mức Bloom | `code791`, `code791_stem` (bỏ Bloom) |
| KC | Thành phần kiến thức/kỹ năng quan sát được | `knowledge_component`, `kc_version` |
| Lớp hành chính | 10A1 | `admin_class` |
| Lớp môn (offering) | Tin học 10A1 học kỳ I | `offering` |
| Module | Đơn vị nội dung được giao | `module`, `module_version` |
| Mục (item) | header, page, assignment, quiz, link | `module_item` |
| Giao (release) | Một lần giao module cho offering, có lịch | `module_release` (con), `path_release` (đợt) |
| Bài nộp | Danh tính bài làm của HS cho một mục | `submission`; phiên bản `submission_version` |
| Lượt làm quiz | | `quiz_attempt`, `question_response` |
| Review | Đánh giá của GV theo rubric | `review`, `review_criterion_result` |
| Quan sát | Một bằng chứng về một KC, có trọng số | `observation` |
| Ước lượng nhu cầu | Trạng thái KC do R0 tính | `needs_estimate` |
| Quyết định mức đạt | Kết luận có thẩm quyền của GV | `attainment_decision` |
| Tiến độ | Hoàn thành thao tác theo quy tắc mục | `activity_progress` |

## 5 Hành trình cốt lõi (phải chạy được từ đầu đến cuối ở mốc M7)

1. Quản trị tạo năm học, lớp 10A1, offering "Tin học 10A1 HK1", phân công GV Lan, ghi danh HS Minh, xác minh liên kết PH của Minh.
2. GV Lan tạo module "Lập trình cơ bản" từ YCCĐ `140110.0601a6`, `140110.0603b4`; thêm trang học liệu, quiz luyện tập 4 câu có gợi ý và khóa, nhiệm vụ "Chương trình tính tiền điện" có rubric 3 tiêu chí; kiểm tra độ phủ; publish version 1.
3. GV Lan giao module cho Tin học 10A1, hạn nộp thứ Sáu 23:59.
4. HS Minh thấy việc cần làm, làm luyện tập (dùng gợi ý một câu), nộp bài v1, nhận biên nhận.
5. GV Lan mở bàn chấm, chấm theo rubric, công bố, chọn ghi quyết định đạt cho một YCCĐ.
6. HS Minh đọc phản hồi, sửa, nộp v2. GV chấm lại; quyết định mới nối tiếp lịch sử.
7. PH của Minh thấy phản hồi đã công bố, xác nhận đồng hành. PH không thấy nháp nhận xét hay bài bạn khác.
8. Worker tạo quan sát và ước lượng R0; GV xem bản đồ nhiệt lớp (chỉ đọc).

## 6 Yêu cầu phi chức năng

| Mã | Yêu cầu | Mục tiêu pilot | Cách đo |
|---|---|---|---|
| NFR-01 | Độ trễ API đọc | p95 < 800 ms | k6, 200 phiên hoạt động |
| NFR-02 | Độ trễ API ghi (không tính upload) | p95 < 1500 ms | k6 |
| NFR-03 | Đợt nộp bài | 200 lượt nộp trong 60 giây, 0 mất, 0 nhân đôi | k6 + đối soát DB |
| NFR-04 | Lỗi 5xx | < 0,5% trong kịch bản tải | k6 |
| NFR-05 | RPO / RTO | ≤ 1 giờ / ≤ 4 giờ | Diễn tập khôi phục sang máy trống |
| NFR-06 | Khả năng tiếp cận | Không lỗi axe mức serious/critical; hoàn thành luồng HS bằng bàn phím; zoom 200%; màn hình 360 px | Playwright + kiểm tay |
| NFR-07 | Tương thích | Chrome, Edge, Firefox, Safari hai bản gần nhất; Android Chrome, iOS Safari | Playwright projects |
| NFR-08 | Kích thước tải trang đầu | JS nén < 250 KB cho route HS | Vite build report |
| NFR-09 | Bảo mật | Không lỗ hổng high/critical trong dependency và image; ZAP baseline không cảnh báo high | CI |
| NFR-10 | Tệp | ≤ 25 MiB/tệp, ≤ 10 tệp/bài nộp; chỉ loại trong allowlist | Test |
| NFR-11 | Nhật ký | 100% lệnh ghi có audit với actor, đối tượng, request_id | Test |
| NFR-12 | Dữ liệu cá nhân | Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 (Luật 91/2025/QH15, hiệu lực 01/01/2026) và văn bản hướng dẫn; nhà trường là bên kiểm soát dữ liệu | Rà soát pháp chế trước pilot |

Các con số là mục tiêu cần đo trong pilot, không phải cam kết đã kiểm chứng.

## 7 Nguồn kế thừa

- Bộ kiến trúc Học cùng nhau 2.1 (29/09/2026), các tệp 01–07.
- Bổ sung 2.2: tệp 08 (AI nhu cầu, lộ trình, tiến độ), tệp 09 (module bài học và assessment).
- Quyết định 791 về quy chế học liệu số: Phụ lục V (quy tắc định danh), VIII (Toán), XXII (Tin học).
- Reigeluth, C. M., Watson, W. R., Watson, S. L., Dutta, P., Chen, Z., & Powell, N. D. P. (2008). Roles for technology in the information-age paradigm of education: Learning management systems. *Educational Technology*, 48(6), 32–39.
