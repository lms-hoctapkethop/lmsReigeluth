# 09 · Kiểm thử và kiểm định chất lượng

Tài liệu này định nghĩa **cách chứng minh** Học cùng nhau chạy đúng, an toàn và có ích. Ba tầng:

1. **Kiểm thử phần mềm**: mã chạy đúng đặc tả (tự động, trong CI).
2. **Kiểm định chất lượng sản phẩm**: bảo mật, hiệu năng, khả năng tiếp cận, khôi phục, khả dụng (có công cụ và quy trình, trước mỗi bản phát hành và trước pilot).
3. **Kiểm định chất lượng giáo dục**: nội dung chương trình đúng, câu hỏi có chất lượng, người dùng thật làm được việc, học tập được hỗ trợ (thẩm định chuyên môn, UAT, đánh giá pilot).

Không tầng nào thay tầng khác: test xanh không chứng minh câu hỏi đúng chuyên môn; giáo viên hài lòng không chứng minh không rò rỉ dữ liệu.

## 1 Mô hình chất lượng

Theo các đặc tính của ISO/IEC 25010, ánh xạ sang kiểm tra cụ thể:

| Đặc tính | Rủi ro chính với Học cùng nhau | Kiểm tra |
|---|---|---|
| Phù hợp chức năng | Tiến độ bị hiểu thành mức đạt; chấm sai; mất bài | Unit, integration, E2E; ca P1a, AC, A, B, C |
| Bảo mật | HS xem bài bạn; PH xem con người khác; lộ đáp án; XSS trong học liệu | Ma trận quyền, SEC-01…SEC-22, ZAP, Trivy |
| Tin cậy | Nộp trùng, mất khi mạng chập chờn, worker dừng | Test đồng thời, idempotency, dừng worker, diễn tập khôi phục |
| Hiệu năng | Cả lớp nộp cùng lúc cuối giờ | k6 PERF-01…PERF-05 |
| Khả dụng | HS lớp 7 không hiểu phản hồi; GV mất nhiều thao tác chấm | UAT, đo thời gian tác vụ, SUS |
| Khả năng tiếp cận | Không dùng được bằng bàn phím, màn hình nhỏ | axe tự động, kiểm tay A11Y-01…A11Y-08 |
| Khả năng bảo trì | Cursor sinh mã phá bất biến | Luật AGENTS.md, lint, kiến trúc phụ thuộc, review |
| Tương thích | Safari iOS, Android cũ | Playwright projects, thiết bị thật trong UAT |

## 2 Tháp kiểm thử và công cụ

| Tầng | Công cụ | Chạy ở | Nội dung | Mục tiêu |
|---|---|---|---|---|
| L0 Tĩnh | `tsc --noEmit`, ESLint (typescript-eslint strict, import/no-restricted-paths), Prettier, gitleaks, `pnpm audit` | Mọi PR | Kiểu, quy tắc phụ thuộc domain ← db, bí mật lọt, lỗ hổng | 0 lỗi |
| L1 Unit | Vitest | Mọi PR | Hàm thuần (docs/06, 37 vector), policies, chuẩn hóa, parse mã 791 | Domain pure + policies: ≥ 90% dòng, ≥ 85% nhánh |
| L2 Cơ sở dữ liệu | psql + `db/tests/schema_invariants.sql`; migration up → down → up; seed chạy hai lần | Mọi PR có đổi `db/` + mỗi ngày | DB01–DB16 và các ca thêm | 100% PASS |
| L3 Integration | Vitest + `@testcontainers/postgresql` (postgres:18), Fastify `inject()` | Mọi PR | Use case qua HTTP thật tới DB thật: quyền, idempotency, đồng thời, outbox, DTO | Mọi lệnh ghi ở docs/05 có ≥ 1 ca thành công, ≥ 1 ca từ chối quyền, các ca lỗi liệt kê |
| L4 Hợp đồng | Schemathesis (từ `openapi.yaml`), snapshot DTO, `oasdiff` | PR đổi API + hằng đêm | Phản hồi đúng schema; không 500 với input fuzz; không thay đổi phá vỡ ngoài ý muốn | 0 lỗi 5xx; 0 vi phạm schema |
| L5 E2E | Playwright (Chromium, Firefox, WebKit, Pixel 7, iPhone 14) + `@axe-core/playwright` | PR vào `main` (Chromium), hằng đêm (tất cả) | Hành trình J01–J12 | 100% PASS; 0 lỗi axe serious/critical |
| L6 Phi chức năng | k6, OWASP ZAP baseline, Trivy, diễn tập khôi phục, dừng worker | Trước mỗi bản phát hành; hằng tuần trên staging | PERF, SEC, REL | Theo ngưỡng mục 7–9 |
| L7 Con người | UAT có kịch bản, thẩm định chuyên môn, pilot | Trước pilot, trong pilot | Mục 11–13 | Theo tiêu chí từng mục |

Cấu trúc thư mục test:

```
packages/domain/src/**/__tests__/*.test.ts     # L1
apps/api/test/integration/<module>/*.test.ts   # L3
apps/api/test/authz/matrix.test.ts              # L3 ma trận quyền
apps/api/test/contract/dto-snapshots.test.ts    # L4
db/tests/*.sql                                  # L2
e2e/journeys/J01-*.spec.ts                      # L5
perf/*.js                                       # L6 k6
tests/reference/pure.reference.mjs              # vector gốc (không sửa)
tests/acceptance/traceability.csv               # ma trận truy vết
```

## 3 Quy ước viết test

- Tên test bắt đầu bằng mã ca: `it('AC05 concurrent submits with same key create one version', …)`.
- Mỗi test integration dựng dữ liệu bằng factory của testkit, không dựa vào thứ tự test khác. Mỗi file dùng một DB riêng (template database clone từ DB đã migrate) để chạy song song.
- Khẳng định **trạng thái DB**, không chỉ HTTP status (ví dụ AC05 đếm `submission_versions`).
- Đồng thời: `Promise.all` hai request qua hai kết nối; lặp 20 lần trong một test để lộ race.
- Thời gian: tiêm `clock` vào use case; không `sleep`.
- Không mock DB, Keycloak trong L3 dùng stub OIDC (`oidc-provider` chạy trong test) phát hành token cho persona; API chạy luồng OIDC thật tới stub.
- Test không được gọi mạng ngoài.

## 4 Nhân vật và dữ liệu kiểm thử

`packages/testkit/personas.ts` tạo bộ dữ liệu cố định dùng cho L3, L5 và UAT trên staging:

| Persona | Trường | Vai trò | Quan hệ |
|---|---|---|---|
| admin.a | A | admin | — |
| gv.lan | A | teacher | Tin10A1 (teach, author, release, review), Tin10A2 (review), Toán10A3 (view) |
| gv.hung | A | teacher | Toán7A4 (đủ quyền) |
| gv.tin11 | A | teacher | Tin11A2, Tin12A3 |
| hs.minh | A | student | lớp 10A1; ghi danh Tin10A1, Toán10A3 |
| hs.an | A | student | lớp 10A2; ghi danh Tin10A2 |
| hs.binh | A | student | lớp 7A4; ghi danh Toán7A4 |
| ph.minh | A | guardian | verified với hs.minh |
| ph.an | A | guardian | verified với hs.an; pending với hs.binh |
| gv.lan.ph | A | teacher + guardian | GV Tin12A3 và PH verified với hs.binh (một người nhiều vai trò) |
| reviewer.tin | A | teacher + curriculum_reviewer (1401) | — |
| gv.b, hs.b | B | teacher, student | offering riêng của trường B |

Nội dung: 5 module mẫu theo tệp 09 mục 6 (Tin 10, 11, 12; Toán 7, 10), mỗi module có trang, quiz practice 4 câu có gợi ý và lỗi hiểu sai, nhiệm vụ có rubric 3 tiêu chí, phiếu ra lớp. KC và cạnh ở trạng thái `approved` trong dữ liệu test (dữ liệu thật phải qua thẩm định).

Trên staging dùng dữ liệu tổng hợp hoặc dữ liệu thật đã ẩn danh bằng script `pnpm anonymize` (đổi tên, xóa email, giữ cấu trúc). Không sao chép dữ liệu production sang staging khi chưa ẩn danh.

## 5 Ma trận ca nghiệm thu

Danh sách đầy đủ, mức kiểm thử và mốc ở `tests/acceptance/traceability.csv`. Nhóm mã:

| Nhóm | Nguồn | Số ca |
|---|---|---|
| INV-01…14 | AGENTS.md | 14 |
| P1a-01…10 | Bộ 2.1 tệp 07 | 10 |
| AC01…16 | Kiến trúc 1.0 (28/09) | 16 |
| A01…18 | Bộ 2.1 tệp 07 | 18 |
| B01…14 | Bổ sung 2.2 tệp 08 | 14 |
| C01…10 | Bổ sung 2.2 tệp 09 | 10 |
| DB01…16 | db/tests/schema_invariants.sql | 16 |
| SEC-01…22 | Mục 6 | 22 |
| PERF-01…05 | Mục 7 | 5 |
| A11Y-01…08 | Mục 8 | 8 |
| REL-01…06 | Mục 9 | 6 |
| J01…12 | Mục 5.1 | 12 |

Một ca chỉ được đánh dấu "đạt" khi có test tự động tương ứng (hoặc biên bản kiểm tay cho A11Y, REL, UAT) lưu trong bằng chứng phát hành (mục 14).

### 5.1 Hành trình E2E

| Mã | Hành trình | Persona | Khẳng định chính |
|---|---|---|---|
| J01 | Đăng nhập, chọn ngữ cảnh, đăng xuất | gv.lan.ph | Đổi ngữ cảnh GV ↔ PH; đăng xuất thu hồi phiên |
| J02 | Quản trị tạo offering, phân công, ghi danh, xác minh PH | admin.a | Dữ liệu hiện đúng ở màn GV, HS, PH |
| J03 | GV soạn module, thấy V01, sửa, publish | gv.lan | Nút publish khóa khi có V01; có version 1 |
| J04 | GV giao module có lịch | gv.lan | HS thấy bài sau `availableFrom` |
| J05 | HS làm luyện tập, dùng gợi ý, gặp phản hồi lỗi hiểu sai | hs.minh | Phản hồi đúng lỗi; không lộ đáp án khi sai |
| J06 | HS soạn bài, mất mạng giữa chừng, lưu lại, nộp, nhận biên nhận | hs.minh | "Đã lưu" chỉ sau 200; biên nhận có giờ server |
| J07 | GV chấm rubric, công bố, không ghi quyết định | gv.lan | Hồ sơ không có quyết định mới (C06) |
| J08 | HS nộp v2 khi GV đang mở v1 | hs.minh + gv.lan | GV thấy cảnh báo, công bố v1 bị chặn (A06) |
| J09 | GV công bố có quyết định đạt; HS xem hồ sơ | gv.lan, hs.minh | Ba lớp số liệu hiển thị tách biệt |
| J10 | PH xem con, xác nhận đồng hành; thử URL con người khác | ph.minh | 404 với hs.an |
| J11 | HS Toán 7 làm phiếu ra lớp, nhập "0,5" và "1.000" | hs.binh | "0,5" được chấm; "1.000" báo nhập lại |
| J12 | GV xem bản đồ nhiệt sau khi worker xử lý | gv.lan | Ô cập nhật; HS không thấy value |

## 6 Kiểm thử bảo mật

| Mã | Ca | Cách kiểm | Kết quả bắt buộc |
|---|---|---|---|
| SEC-01 | IDOR: đổi `learnerId`, `submissionId`, `releaseId`, `fileId` sang của người khác | Ma trận quyền L3 + Schemathesis có header persona | 404, không dữ liệu |
| SEC-02 | CSRF: POST thiếu hoặc sai `X-CSRF-Token`, sai `Origin` | L3 | 403 `CSRF_FAILED`, không ghi |
| SEC-03 | Cookie phiên: HttpOnly, Secure, SameSite=Lax, không Domain | L3 kiểm header `Set-Cookie` | Đủ cờ |
| SEC-04 | Cố định phiên: cookie trước đăng nhập không dùng lại sau đăng nhập | L3 | Phiên mới |
| SEC-05 | Thu hồi: khóa user, thu hồi liên kết PH, gỡ phân công → request tiếp theo bị từ chối | L3 (AC03) | Ngay lập tức |
| SEC-06 | XSS trong học liệu và bài nộp: `<script>`, `javascript:` link, SVG có script, HTML trong code block | L3 (sanitizer) + E2E (không alert) | Bị loại hoặc hiển thị dạng văn bản |
| SEC-07 | Tệp đa hình: PDF có JS, ảnh chứa HTML, đuôi giả, EICAR | L3 + worker | 415 hoặc `infected`; tải xuống có `Content-Disposition: attachment`, `nosniff`, `CSP sandbox` |
| SEC-08 | Lộ đáp án: tìm chuỗi khóa trong mọi phản hồi HS, HTML, source map, cache | L3 (C09, A04) + E2E | Không tìm thấy |
| SEC-09 | Gán thuộc tính hàng loạt: body có `correct`, `score`, `role`, `learnerId`, `schoolId` | L3 (C08) | 422 hoặc bị bỏ qua, không ảnh hưởng |
| SEC-10 | Leo quyền qua ngữ cảnh: `POST /me/context` với vai trò không có | L3 | 403 |
| SEC-11 | Open redirect `returnTo=https://evil` | L3 | Chỉ chấp nhận đường dẫn tương đối bắt đầu `/` |
| SEC-12 | Rate limit đăng nhập và endpoint trả lời | L3 | 429 đúng ngưỡng |
| SEC-13 | Tấn công dò mật khẩu | Cấu hình Keycloak brute force; kiểm tay | Khóa tạm sau 8 lần |
| SEC-14 | SQL injection, input lớn, unicode lạ | Schemathesis fuzz | Không 500, không lỗi SQL lộ ra |
| SEC-15 | Header bảo mật: CSP, HSTS, frame-ancestors, nosniff | ZAP baseline + curl | Có đủ |
| SEC-16 | Log không chứa bí mật và nội dung bài | L3: bật log vào bộ nhớ, chạy luồng nộp, quét chuỗi | Không có cookie, token, nội dung bài |
| SEC-17 | Worker không đọc đáp án, không ghi quyết định | DB15 | Lỗi quyền DB |
| SEC-18 | Liệt kê tài nguyên: phản hồi 403/404 nhất quán | L3 | Không phân biệt "tồn tại nhưng cấm" với "không tồn tại" cho dữ liệu HS |
| SEC-19 | Lỗ hổng phụ thuộc | `pnpm audit --prod`, Trivy image | 0 high/critical chưa có ngoại lệ ghi rõ |
| SEC-20 | Bí mật trong repo | gitleaks | 0 phát hiện |
| SEC-21 | Console quản trị Keycloak và `/metrics` không truy cập từ Internet | curl từ ngoài | 404 |
| SEC-22 | Prompt injection vào dữ liệu AI (khi bật AI) | Để dành M10+ (A16, A17) | — |

Trước pilot: kiểm thử xâm nhập độc lập (nội bộ trường hoặc đơn vị thuê) theo OWASP ASVS mức 2 cho các nhóm: xác thực, phiên, kiểm soát truy cập, xử lý tệp, validation. Lỗi high trở lên phải sửa trước khi nhập dữ liệu thật.

## 7 Kiểm thử hiệu năng (k6)

Dữ liệu: 1 trường, 1 200 HS, 60 GV, 40 offering, 30 module/offering, 10 000 bài nộp lịch sử, 200 000 quan sát. Máy staging cùng cấu hình production.

| Mã | Kịch bản | Tải | Ngưỡng |
|---|---|---|---|
| PERF-01 | Đọc: HS mở Hôm nay → bài → mục | 200 người dùng ảo, 10 phút | p95 < 800 ms, lỗi < 0,5% |
| PERF-02 | Tự lưu nháp | 200 người dùng ảo, lưu mỗi 10 giây | p95 < 1 000 ms |
| PERF-03 | Đợt nộp cuối giờ | 200 lượt nộp trong 60 giây | p95 < 1 500 ms; đối soát DB: đúng 200 phiên bản, 0 trùng (NFR-03) |
| PERF-04 | Luyện tập | 150 người dùng ảo, trả lời mỗi 5 giây | p95 < 600 ms; `outbox_pending` về 0 trong 2 phút sau khi dừng tải |
| PERF-05 | GV mở hàng chờ và bản đồ nhiệt lớp 45 HS | 20 người dùng ảo | p95 < 1 200 ms |

Báo cáo lưu `docs/qa/releases/vX/perf.md`: cấu hình máy, commit, dữ liệu, kết quả, nút thắt (dùng `pg_stat_statements` top 10 truy vấn).

## 8 Kiểm thử khả năng tiếp cận

Tự động: mỗi spec E2E gọi `checkA11y()` (axe, chuẩn WCAG 2.1 AA) sau khi trang ổn định; lỗi `serious`/`critical` làm test fail.

Kiểm tay trước mỗi bản phát hành lớn (biên bản trong bằng chứng):

| Mã | Kiểm |
|---|---|
| A11Y-01 | Luồng HS J05, J06 chỉ bằng bàn phím |
| A11Y-02 | Bàn chấm bằng bàn phím và phím tắt |
| A11Y-03 | Zoom 200% trên desktop: không mất chức năng |
| A11Y-04 | Chiều rộng 360 px: không cuộn ngang, nút đủ lớn |
| A11Y-05 | Trình đọc màn hình (NVDA + Firefox; VoiceOver iOS): đọc được trạng thái lưu, kết quả nộp, phản hồi |
| A11Y-06 | Sắp xếp mục trong Studio không cần kéo thả |
| A11Y-07 | Trạng thái KC phân biệt được khi in đen trắng (có chữ, hoa văn) |
| A11Y-08 | Tương phản văn bản ≥ 4,5:1 trong cả hai chế độ sáng tối |

Kết quả tự động không đủ để tuyên bố "đạt WCAG"; chỉ ghi "không có lỗi axe" và kết quả kiểm tay.

## 9 Kiểm thử tin cậy và khôi phục

| Mã | Ca | Kết quả |
|---|---|---|
| REL-01 | Dừng worker 10 phút trong lúc HS nộp và GV công bố; khởi động lại | Không mất bài, review; thông báo gửi bù, không trùng (A08) |
| REL-02 | Kill API giữa request nộp (sau commit, trước phản hồi); client gửi lại | Một phiên bản, cùng biên nhận (AC06) |
| REL-03 | ClamAV dừng | Upload vẫn nhận (pending); nộp bị 423 có thông báo rõ; hồi phục khi clamd chạy |
| REL-04 | Keycloak dừng | Phiên đang có vẫn dùng; đăng nhập mới báo lỗi thân thiện |
| REL-05 | Diễn tập khôi phục sang máy trống (docs/08 mục 6) | RPO ≤ 1 giờ, RTO ≤ 4 giờ, AC13 đạt |
| REL-06 | Migration trên bản sao dữ liệu staging: up, chạy test, hoàn tác app về bản cũ | App cũ chạy được với schema mới |

## 10 Cổng chất lượng

| Cổng | Khi | Bắt buộc |
|---|---|---|
| G1 PR | Mọi PR | L0, L1, L2 (nếu đổi db), L3, snapshot DTO, `openapi:check`, build web; 0 test bị skip mới; PR mô tả mốc, ca đã thêm; 1 người duyệt (người hoặc checklist review bởi AI thứ hai + người) |
| G2 Main | Merge vào main | G1 + E2E Chromium J01–J12 + axe; coverage không giảm quá 1 điểm |
| G3 Release | Tag vX.Y.Z | G2 + E2E đủ trình duyệt + Schemathesis + ZAP baseline + Trivy + PERF-01…05 trên staging + REL-01, REL-02, REL-06 + A11Y kiểm tay (phát hành lớn) + CHANGELOG |
| G4 Pilot | Trước khi nhập dữ liệu HS thật | G3 + REL-05 diễn tập khôi phục + kiểm thử xâm nhập không còn lỗi high + UAT đạt (mục 11) + thẩm định YCCĐ/KC/câu hỏi cho các module dùng trong pilot (mục 12) + hồ sơ bảo vệ dữ liệu cá nhân được nhà trường duyệt |
| G5 Mở rộng | Sau pilot, trước khi dùng cho nhiều lớp | Báo cáo pilot (mục 13) + số liệu vận hành 4 tuần không có sự cố S1 |

## 11 UAT (kiểm thử chấp nhận người dùng)

**Người tham gia**: 2 GV mỗi môn (Tin, Toán), 1 tổ trưởng chuyên môn, 10 HS mỗi khối (7, 10, 11, 12) gồm cả HS học chậm và HS dùng điện thoại, 5 PH, 1 quản trị trường.

**Hình thức**: buổi 60 phút mỗi nhóm trên staging với dữ liệu tổng hợp; người quan sát ghi phiếu; không hướng dẫn trong lúc làm trừ khi bế tắc quá 3 phút.

**Nhiệm vụ và tiêu chí**:

| Nhóm | Nhiệm vụ | Đạt khi |
|---|---|---|
| GV | Soạn một module từ YCCĐ có sẵn: 1 trang, 3 câu luyện tập có gợi ý, 1 nhiệm vụ rubric 3 tiêu chí; publish; giao | ≥ 80% GV hoàn thành trong 40 phút không trợ giúp |
| GV | Chấm 5 bài theo rubric và công bố | Trung vị ≤ 3 phút/bài; không công bố nhầm bài |
| HS | Tìm việc cần làm, làm luyện tập, nộp bài, đọc phản hồi | ≥ 90% hoàn thành; HS tự nói lại được "việc tiếp theo là gì" |
| HS lớp 7 | Làm phiếu ra lớp có câu số | ≥ 90% nhập đúng định dạng sau tối đa một lần báo lỗi |
| PH | Tìm phản hồi mới của con, xác nhận đồng hành | ≥ 90% hoàn thành trong 5 phút |
| Quản trị | Nhập 40 tài khoản từ CSV, xác minh 5 liên kết PH | Hoàn thành, không sai liên kết |

Sau buổi: thang SUS (mục tiêu ≥ 70 với GV và HS THPT), 3 câu hỏi mở. Lỗi phát hiện ghi vào hệ thống lỗi với mức độ (mục 15). UAT đạt khi mọi nhiệm vụ đạt tiêu chí và không còn lỗi S1, S2 mở.

## 12 Thẩm định nội dung chương trình và câu hỏi

Phần mềm đúng nhưng YCCĐ sai hoặc câu hỏi kém thì chẩn đoán sai. Quy trình cho mọi nội dung dùng trong pilot:

1. **YCCĐ**: 2 GV bộ môn đối chiếu độc lập từng YCCĐ trong seed với văn bản gốc (phụ lục QĐ 791 và CT GDPT 2018). Ưu tiên 19 dòng có cờ `extraction=check`. Khác biệt → tổ trưởng quyết. Trạng thái chuyển `source_checked` rồi `approved` trong màn `/chuyen-mon`.
2. **KC và cạnh tiên quyết**: GV đề xuất (có thể nhờ AI gợi ý ở giai đoạn sau), tổ chuyên môn duyệt. Tiêu chí: mỗi KC có tiêu chí quan sát được; mỗi cạnh tiên quyết có lý do sư phạm ngắn.
3. **Câu hỏi**: mỗi câu được một GV khác người soạn rà theo checklist: đúng một đáp án (câu một lựa chọn), đáp án tính lại được, phương án nhiễu hợp lý và gắn lỗi hiểu sai, KC observable đúng, Bloom khớp, ngôn ngữ hợp lứa tuổi, gợi ý không lộ đáp án.
4. **Rubric**: mô tả mức phân biệt được; hai GV chấm độc lập 10 bài mẫu, tỉ lệ đồng thuận theo tiêu chí ≥ 80% (hoặc kappa có trọng số ≥ 0,6); thấp hơn → sửa mô tả mức.
5. **Phân tích câu hỏi sau pilot** (khi mỗi câu có ≥ 30 lượt): độ khó p (tỉ lệ đúng lần đầu), độ phân biệt (tương quan điểm-tổng), phân bố phương án. Câu có p > 0,95 hoặc < 0,15, độ phân biệt < 0,15, hoặc phương án nhiễu không ai chọn → xem lại. Kết quả ghi vào `difficulty_calibrated` và bỏ cờ `provisional` khi đạt.

## 13 Đánh giá pilot

Pilot: 1 học kỳ, mỗi môn 1–2 lớp dùng Học cùng nhau, có lớp đối chứng cùng khối nếu nhà trường đồng ý.

| Câu hỏi | Chỉ số | Nguồn |
|---|---|---|
| HS có biết việc tiếp theo và vì sao? | % HS trả lời đúng khi hỏi ngẫu nhiên hằng tuần | Khảo sát ngắn trong ứng dụng (tự nguyện) |
| Phản hồi có dẫn tới sửa bài? | % bài có v2 sau phản hồi `changes_requested`; mức rubric v2 so với v1 | Dữ liệu review |
| GV có đỡ việc lặp lại? | Thời gian soạn → publish; thời gian chấm trung vị | Log sự kiện (không nội dung) |
| Nhóm cần hỗ trợ có được hỗ trợ? | Thời gian từ khi KC "Cần hỗ trợ" tới khi có hoạt động bổ trợ | Quan sát + nhu cầu |
| Hệ thống có chạy ổn? | Uptime giờ học, số sự cố S1/S2, mất dữ liệu = 0 | Giám sát |
| Ước lượng R0 có hợp lý? | Đồng thuận giữa trạng thái R0 và đánh giá của GV trên mẫu 50 HS × KC | GV đánh giá mù |

Không dùng số lượt đăng nhập hay thời gian online làm chỉ số chính. Kết quả so sánh với lớp đối chứng chỉ mang tính mô tả khi không có thiết kế thực nghiệm chặt chẽ. Báo cáo pilot lưu `docs/qa/pilot-report.md`.

## 14 Bằng chứng mỗi bản phát hành

`docs/qa/releases/vX.Y.Z/`:

- `summary.md`: commit, ngày, cổng đã qua, ngoại lệ có duyệt.
- `test-report.xml` (JUnit từ Vitest và Playwright), `coverage-summary.json`.
- `schemathesis.txt`, `zap-baseline.html`, `trivy.txt`.
- `perf.md` (G3), `a11y-manual.md` (phát hành lớn), `restore-drill.md` (G4, mỗi học kỳ).
- `traceability.csv` với cột `status` và `evidence` đã điền.

## 15 Quản lý lỗi

| Mức | Định nghĩa | Ví dụ | Xử lý |
|---|---|---|---|
| S1 Nghiêm trọng | Lộ dữ liệu giữa người dùng; mất hoặc sai bài nộp; quyết định mức đạt sai hoặc tự sinh; không đăng nhập được toàn trường | PH xem được bài HS khác; nộp bài báo thành công nhưng không có trong DB | Dừng phát hành; sửa trong 24 giờ; hotfix; báo nhà trường nếu ảnh hưởng dữ liệu thật; thêm test hồi quy |
| S2 Cao | Chức năng chính không dùng được cho một nhóm; lỗi bảo mật mức trung bình | Safari iOS không nộp được; lỗi XSS tự phản chiếu | Sửa trước bản phát hành kế tiếp (≤ 1 tuần) |
| S3 Trung bình | Có cách làm khác; hiển thị sai không ảnh hưởng dữ liệu | Sắp xếp hàng chờ sai | Lên kế hoạch trong 2 mốc |
| S4 Thấp | Thẩm mỹ, chính tả | Lệch khoảng cách | Khi thuận tiện |

Mọi lỗi S1, S2 được sửa kèm test tự động tái hiện lỗi trước khi sửa (test fail → sửa → test pass).

## 16 Definition of Done

**Một tính năng (PR)**: đúng đặc tả docs/05–07; test L1/L3 cho mọi nhánh trong đặc tả kể cả từ chối quyền; OpenAPI và contracts cập nhật; chuỗi hiển thị trong `vi.ts`; trạng thái giao diện đủ (docs/07 mục 4); không vi phạm INV; `pnpm verify` xanh; ca trong `traceability.csv` cập nhật `test_location`.

**Một mốc (M…)**: mọi PR của mốc đã merge; điều kiện hoàn thành của mốc trong docs/10 đạt; demo trên staging cho chủ dự án; ghi chú mốc trong CHANGELOG.

## 17 Test không ổn định

Test fail ngẫu nhiên được chuyển vào `tests/QUARANTINE.md` (mã ca, issue, người phụ trách, ngày hết hạn ≤ 7 ngày) và chạy ở job riêng không chặn. Hết hạn mà chưa sửa → chặn G2. Không được xóa test để CI xanh.
