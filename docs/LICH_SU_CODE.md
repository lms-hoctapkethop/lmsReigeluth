# Lịch sử thay đổi — adapter JSON và P1a

Mốc: 29/09/2026. Nhánh `main`. App vẫn là Next.js, phiên cookie, file JSON. Không chuyển Postgres, Fastify hay Keycloak.

## Việc đã code

- `revision` cho toàn bộ file JSON. Thiếu `expectedRevision` trên lệnh ghi nghiệp vụ trả HTTP 400.
- Mọi đường ghi nghiệp vụ đi qua `commitWrite`: khóa, đọc, kiểm mã gửi lại, kiểm revision, áp dụng, rồi mới tăng revision và ghi biên nhận trong cùng một lần ghi (file tạm + đổi tên). Đọc không ghi lại file.
- Hai lệnh khác key, cùng revision: một lệnh commit, lệnh kia HTTP 409 mã `REVISION_CONFLICT`.
- Gửi lại cùng key và cùng nội dung trả biên nhận cũ, không gọi lại phần ghi. Cùng key, khác nội dung: HTTP 422 mã `IDEMPOTENCY_MISMATCH`. Kiểm mã gửi lại đứng trước kiểm revision.
- Lệch `draft.version` vẫn HTTP 409 ở cả lưu nháp và nộp bài thực hành, không dùng mã `REVISION_CONFLICT`.
- Một writer: hàng đợi trong tiến trình cộng file khóa PID. Tiến trình khác còn sống nhận HTTP 503 mã `SINGLE_WRITER`.
- Module P1a nằm cạnh bài `if–else` hiện có: năm loại mục, ảnh chụp bất biến, quiz hoàn thành bằng lần nộp và không ghi KC, `min_score` và cổng KC trả `FEATURE_NOT_ENABLED`.
- `classDeliveryEnabled` chỉ đúng khi file ghi đúng `true`. Khi cờ tắt, `action: "deliver"` trả `CLASS_DELIVERY_OFF` trước khi ghi. Trên file lớp của trường, cờ đã được bật sau đó; xem mục máy chủ trường.
- Tuần lớp trong seed và trên file trường giữ `28/09 – 04/10/2026`. Kho 34 bài được nhập sau đó dưới dạng bản soạn, không thay bài đang học.
- Các lời gọi file của adapter có chú thích `turbopackIgnore` để bản build không kéo cả cây mã vào gói server.

## Kết quả `npm test` đã chạy

Lệnh: `node --experimental-strip-types --import ./tests/register.mjs --test tests/p1a.test.ts` (qua `npm test`). Node v22.14.0. File dữ liệu là thư mục tạm, không phải `data/db.json`.

Stdout của lần chạy sau khi sửa kiểu trong file kiểm thử (cùng các assertion với lần chạy trước đó):

```json
{"draft-409-save":"PASS","draft-409-submit":"PASS","idempotency-retry":"PASS","idempotency-mismatch":"PASS","P1a-08":"PASS","SINGLE_WRITER":"PASS","P1a-01":"PASS","P1a-02":"PASS","P1a-03":"PASS","P1a-04":"PASS","P1a-05":"PASS","P1a-06":"PASS","P1a-07":"PASS","P1a-09":"PASS","P1a-10":"PASS","CLASS_DELIVERY_HTTP":"PASS"}
```

`CLASS_DELIVERY_HTTP` gọi thẳng hàm mà route dùng. Chưa mở socket HTTP.

Sau kiểm thử, `data/db.json` của máy này vẫn không có trường `revision`, không có `classDeliveryEnabled`, `weekLabel` vẫn `28/09 – 04/10/2026`, chưa có module soạn.

## Kết quả HTTP trên server tạm

`next start` cổng 43141, `HCN_DB_PATH=/tmp/hcn-ui/db.json` (bản sao). Không đụng `data/db.json`.

- Giáo viên tạo mẫu: 5 dòng, 3 requirement, revision 1, tuần `28/09 – 04/10/2026`, `classDeliveryEnabled` false.
- Lưu tiêu đề tăng revision. `action: "deliver"` trả HTTP 403 mã `CLASS_DELIVERY_OFF`. Thiếu `expectedRevision` trả HTTP 400.
- Học sinh không thấy bản soạn. `GET /api/learn` vẫn là bài `Bài 03 · Rẽ nhánh if–else`, tuần không đổi, revision có trong payload.
- Lưu nháp với `version: 9` trả HTTP 409, câu “Bản nháp trên máy chủ đã mới hơn. Hãy tải lại trước khi lưu.”, không có mã `REVISION_CONFLICT`.

Trên trình duyệt, cùng server: giáo viên mở Module soạn thảo, thấy giao lớp tắt và mẫu số 3, lưu tiêu đề “Tuần mẫu trên lớp”, tải lại vẫn còn tiêu đề đó. Tổng quan vẫn hiện tuần `28/09 – 04/10/2026` và bài 03. Không có nút giao lớp.

Sau các thao tác đó, `data/db.json` vẫn không có `revision`, không có `classDeliveryEnabled`, tuần vẫn `28/09 – 04/10/2026`. File tạm có bản soạn, `pathRelease` null, giao lớp false.

## Còn NOT_RUN sau lần chạy tạm

Các mục dưới đây đã được chạy sau đó trên máy chủ trường. Kết quả nằm ở mục tiếp theo. Không lấy mục này làm trạng thái hiện tại.

- Nhập kho 34 bài dạng bản soạn: đã chạy, xem mục máy chủ trường.
- Bật giao lớp trên dữ liệu trường: đã chạy, không phát hành kho 34 bài.
- Triển khai bản có lệnh nhập và bật giao lớp: tiến trình trường đang chạy commit `bfc0a91`.
- Hợp đồng ghi W01–W06 và W08–W12: đã chạy. W07 vẫn NOT_RUN.
- Thẩm định chuyên gia 71 KC và xuất Canvas: vẫn NOT_RUN.

## Máy chủ trường, 29/09/2026

Máy `160.191.49.65`, dịch vụ `lms-hoctapkethop`, cổng nội bộ `127.0.0.1:4317`, site https://lms.hoctapkethop.edu.vn. Tiến trình đang phục vụ là bản build của `bfc0a91`. File lớp trước khi nhập: SHA-256 `9b5bccbf42cf33537f26a1a13bd42837a237adf10f6017b905489439c0e2e685`, bản sao `/home/plhien/backups/lms-20260929/db-before-all34.json`.

Mọi lệnh ghi vào file lớp đi qua HTTP của tiến trình đang giữ `writer.lock`. Không mở tiến trình ghi thứ hai trên cùng file đó.

### Nhập kho và bật giao lớp

Giáo viên Nguyễn Hà gửi 34 lệnh `action: "import-draft"` tới `POST /api/modules`. Cả 34 lệnh HTTP 200. Mỗi bài `state: draft`, 5 mục, 3 requirement. Bản soạn `TH10-W1` giữ nguyên.

Sau nhập, file lớp có 35 bản soạn, toàn bộ là `draft`. Revision 36. Tuần `28/09 – 04/10/2026`. Bài đang học `Bài 03 · Rẽ nhánh if–else`, trạng thái published. `classDeliveryEnabled` vẫn false. `pathRelease` null. Nháp thực hành vẫn version 1. Lần nộp 0. Quyết định KC 0. Quiz bài 03 vẫn 12.

Học sinh Lê An gọi `GET /api/modules`: 0 bản soạn, `pathRelease` null. `GET /api/learn` vẫn là bài 03 và tuần đó.

Quản trị gọi `POST /api/admin/organization` với `action: "set-class-delivery"`, `enabled: true`. HTTP 200. `classDeliveryEnabled` true. Tuần và bài 03 không đổi. Revision 37. Không có lệnh giao 34 bài. `pathRelease` vẫn null. Học sinh sau khi bật cờ vẫn thấy 0 bản soạn và không có đường giao.

SHA-256 file lớp sau các lệnh này: `394034559ef3a347ab006b299d70b1cddd2cf4c7754abbfd669e9f3ea99ceaa1`.

`GET https://lms.hoctapkethop.edu.vn/login` trả 200 sau khi ghi.

### Hợp đồng ghi

W01, W02, W04, W05, W06, W10, W12 và `canvas-import` gọi vào tiến trình đang phục vụ file lớp. File không đổi ở từng ca từ chối.

W03, W08, W09 và W11 ghi dữ liệu, nên chạy trên bản sao `/tmp/hcn-w/db.json`, cùng mã đã build, tiến trình `next start` cổng `4318`, khóa riêng. Tiến trình này đã tắt. SHA-256 file lớp trước và sau các ca đó vẫn là `394034559ef3a347ab006b299d70b1cddd2cf4c7754abbfd669e9f3ea99ceaa1`. Quiz của Lê An trên file lớp không tăng.

| Mã | Kết quả | Điều đã quan sát |
|---|---|---|
| W01 | PASS | `deliver` kèm `min_score` 2/3 trả 422 `FEATURE_NOT_ENABLED`. Nhập mục `kind: min_score` cũng 422, không thành `submit`, không có bản `TH10-W01-PROBE`. |
| W02 | PASS | Giao hai module, module sau có `kcGate`, trả 422 `FEATURE_NOT_ENABLED`. `pathRelease` vẫn null. |
| W03 | PASS | Trên bản sao: nộp quiz bài 03, điểm 3/3, thêm một attempt. `decisions` và `reviews` không đổi. |
| W04 | PASS | Trên bản sao, sau khi đã có `review-1`: principal `canvas` gọi công bố nhận xét, body có `role: teacher` và `review_id: review-1`. HTTP 403 `ATTAINMENT_WRITE_FORBIDDEN`. Review và decision không đổi. Tiến trình lớp cũng trả 403 cùng mã, file lớp không đổi. |
| W05 | PASS | Học sinh gửi principal `canvas`, `role: teacher` và `decision` vào `POST /api/learn`. HTTP 403 `ATTAINMENT_WRITE_FORBIDDEN`. File lớp không đổi. |
| W06 | PASS ở lối từ chối P1a | `action: kc-gate` với quiz 3/3 và không có decision đạt, trả 422 `FEATURE_NOT_ENABLED`. Không có `gate_passed`, không thêm decision. Đây không phải kết quả cổng P2. |
| W07 | NOT_RUN | P2 chưa có. Không tạo decision đạt giả để gọi cổng. |
| W08 | PASS | Trên bản sao: giáo viên công bố `proposedDecisions: []` cho lần nộp 1. Thêm một review trỏ `versionNo` 1. Decision không đổi. |
| W09 | PASS với giới hạn đầu KC | Trên bản sao: một lệnh công bố decision `syntax`. Review, decision và revision của file tăng đúng một lần trong cùng lần ghi. `review.versionNo` là 1, trùng lần nộp. `publishedAt` của review bằng `decidedAt` của decision. Không có revision riêng cho attainment head; đầu KC là quyết định hiện hành sau lần ghi đó. |
| W10 | PASS | `learnerId: learner-other` trả 403 `SCOPE_MISMATCH`. Trên bản sao, lần nộp 1 đã tồn tại; review và decision không tăng. Trên file lớp, ca này cũng 403 và không ghi. |
| W11 | PASS trên revision của file | Hai lệnh công bố cùng `expectedRevision`, khác nội dung, chạy song song trên bản sao. Một HTTP 200, một HTTP 409 `REVISION_CONFLICT`. Revision, review và decision chỉ tăng một. File vẫn là JSON. App không có revision riêng của attainment head. |
| W12 | PASS | File lớp: học sinh gửi `role: teacher`, `score`, `evidence_authority` và decision. `POST /api/teaching` trả 403. `POST /api/learn` trả 422 `ATTAINMENT_WRITE_FORBIDDEN`. Không ghi KC. Bản sao: cùng các trường đó với quiz, điểm lưu là 3 do đáp án server chấm, không phải `score: 99` trong body. Decision không đổi. |

### Vẫn NOT_RUN

- W07, cổng P2 khi đã có decision đạt đã công bố: NOT_RUN.
- Thẩm định chuyên gia 71 KC: NOT_RUN. Trong `course_Tin10_ALL34_3.2.1.json` cả 71 KC có `validation.expert_review` là `pending`.
- Xuất Canvas: NOT_RUN. `examples/canvas_export_report_design.json` có `status: design_only`, `canvas_import_tested: false`, `target: null`. Lệnh `canvas-import` trên app trả 403 là từ chối ghi, không phải lần xuất đã chạy.
