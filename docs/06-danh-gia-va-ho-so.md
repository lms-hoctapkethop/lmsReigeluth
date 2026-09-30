# 06 · Chấm điểm, quan sát, hồ sơ và R0

Mọi hàm ở đây là **hàm thuần** (không I/O). Bản cài đặt tham chiếu chạy được và 39 vector kiểm thử (37 từ 3.0, 2 vector V05 tiên quyết thêm ở 3.3) nằm ở `tests/reference/pure.reference.mjs` (`node tests/reference/pure.reference.mjs` → `ALL 39 PASS`). Cursor port sang TypeScript trong `packages/domain` và **giữ nguyên các vector** trong Vitest; không sửa vector để test xanh.

| Hàm | Đặt ở | Vector |
|---|---|---|
| `normalizeNumber` | `packages/domain/src/quiz/normalize.ts` | N01–N09 |
| `gradeResponse` | `packages/domain/src/quiz/grade.ts` | G01–G08 |
| `observationFromResponse`, `observationFromCriterion` | `packages/domain/src/insight/observe.ts` | O01–O08 |
| `r0Estimate` | `packages/domain/src/insight/r0.ts` | R01–R06 |
| `rootGaps` | `packages/domain/src/insight/rootGaps.ts` | T01–T03 |
| `computeCoverage` | `packages/domain/src/authoring/coverage.ts` | V01, V02, V05+V07 |

## 1 Chuẩn hóa số

- Chấp nhận: số nguyên, thập phân dấu phẩy (`0,5`) hoặc dấu chấm (`2.5`, `0.125`), phân số `a/b`, dấu trừ `-` hoặc `−` (U+2212).
- Từ chối (trả 422, không chấm sai): rỗng, chữ, chia cho 0, và dạng nhập nhằng `1.000`, `12.500` (ở Việt Nam dấu chấm thường phân tách hàng nghìn). Thông báo: "Em nhập số thập phân bằng dấu phẩy, ví dụ 1,5".
- Câu số trong đề nên ghi rõ cách nhập (Studio có gợi ý mặc định).

## 2 Chấm câu hỏi

| qtype | Đúng khi | Điểm |
|---|---|---|
| single_choice | `option = key.option` | 1 / 0 |
| multi_choice `all_or_nothing` | tập chọn = tập đáp án | 1 / 0 |
| multi_choice `partial` | tập chọn = tập đáp án | `max(0, (đúng − sai)/số đáp án)` làm tròn 3 chữ số |
| numeric | `|giá trị − đích| ≤ tolerance` với đích là `value` hoặc một trong `accept` | 1 / 0 |
| short_text | chuỗi chuẩn hóa (trim, gộp khoảng trắng, không phân biệt hoa thường nếu cấu hình) ∈ `accept` | 1 / 0; `manual` → `correct = null`, chờ GV (M10) |

Điểm lượt quiz = tổng điểm câu trả lời cuối của từng câu; `max_score` = số câu.

## 3 Quan sát

### 3.0 Chốt ở 3.7 (M8)

- **Điểm câu**: use case chấm (M6) ghi thêm `question_responses.points` (0..1, 3 chữ số) lúc INSERT; `correct = (points = 1)`. Hàng cũ `points` NULL: worker suy `1` nếu `correct = true`, `0` nếu `false`, bỏ qua nếu NULL. Worker không bao giờ đọc `question_keys`.
- **Nguồn quan sát** (consumer `insight.deriveObservations`, chỉ chạy bằng role `hcn_worker`):
  - `QuestionAnswered`: payload `responseIds` (chuỗi nối dấu phẩy, M6). Practice: mỗi hàng. Mục đích khác: chỉ các hàng trong payload (đã là hàng cuối khi nộp).
  - `ReviewPublished`: mọi `review_criterion_results` của review có tiêu chí gắn KC.
  - KC lấy từ `question_kc_links` role `observable` (không `required`, B01) hoặc `rubric_criteria.kc_version_id`; ghi đúng `kc_version_id` lúc đó.
  - `source_type`: purpose của assessment (`diagnostic`, `practice`, `exit_ticket`) hoặc `review`; `self_assessment`, `summative` không tạo.
  - `hints_used`, `provisional_item` chép sang; `observed_at` = `answered_at` hoặc `published_at`.
  - `ON CONFLICT (source_ref, kc_version_id) DO NOTHING` (B02). Có hàng mới thì phát `ObservationsAdded {learnerId, offeringId, kcIds}`.
- **Backfill** (CLI `pnpm insight:backfill`, chạy một lần khi triển khai M8 và an toàn khi chạy lại): duyệt mọi `question_responses` của lượt đã nộp (mục đích khác practice: chỉ hàng `try_no` lớn nhất mỗi câu) và của practice (mọi hàng), cùng mọi review `published`; tạo quan sát như trên rồi tính lại ước lượng. Sự kiện M6–M7 đã bị đánh dấu `done` không bị mất.


Quan sát là cầu nối từ minh chứng tới ước lượng. Worker tạo quan sát, không bao giờ API.

### 3.1 Từ câu trả lời

Mỗi hàng `question_responses` tạo một quan sát cho **mỗi KC trong Q_observable** của câu (bảng `question_kc_links` role `observable`), không cho KC `required` (B01).

| Điều kiện | Trọng số |
|---|---|
| diagnostic, exit_ticket | 0,7 |
| practice, lần 1–2, không gợi ý | 0,6 |
| practice, lần 1–2, có gợi ý | 0,3 |
| practice, lần 3 | 0,2 |
| practice, lần ≥ 4 | không tạo |
| self_assessment, summative | không tạo |
| short_text chấm tay chưa chấm | không tạo |
| câu `provisional` | chia đôi trọng số trên |

`score` = điểm câu (0..1). `source_ref = 'response:<question_responses.id>'`.

### 3.2 Từ review đã công bố

Mỗi tiêu chí có KC tạo một quan sát trọng số 1,0: `meets` → 1; `developing` → 0,5; `not_yet` → 0; `not_shown` → không tạo (C05); tiêu chí không gắn KC → không tạo. `source_ref = 'review_criterion:<review_id>:<criterion_id>'`.

## 4 Ước lượng R0

**Chốt ở 3.7:** ước lượng tính theo **KC** (gộp quan sát của mọi version thuộc cùng `knowledge_components.id`), ghi `needs_estimates.kc_version_id` = version `approved` hiện hành của KC đó. Hồ sơ và bản đồ nhiệt đọc view `needs_current_kc` (0009). Consumer `insight.recomputeNeeds` nhận `ObservationsAdded`, gọi `r0Estimate` (39 vector), INSERT chỉ khi `status` hoặc `value` khác hàng hiện hành cùng `model_version`. Đổi mô hình (`R0@1.1.0`…) = CLI `pnpm insight:recompute --model <ver>` tính lại toàn bộ, không xóa hàng cũ (B11). Hằng `R0_MODEL_VERSION` trong code quyết định bản hiển thị.


Đầu vào: mọi quan sát của (HS, offering, KC version). Đầu ra ghi `needs_estimates` với `model_version = 'R0@1.0.0'`.

1. Dưới 2 quan sát → `insufficient`, value null.
2. `value = Σ(weight × score) / Σ weight` làm tròn 4 chữ số.
3. `needs_support` nếu `value < 0,5` **hoặc** quan sát review gần nhất có `score < 0,5`.
4. `strong` nếu `value ≥ 0,8`, có ít nhất 3 quan sát và ít nhất một quan sát không phải practice có gợi ý.
5. Còn lại `developing`.

Nhãn hiển thị: `insufficient` → "Chưa đủ bằng chứng"; `needs_support` → "Cần hỗ trợ"; `developing` → "Đang phát triển"; `strong` → "Có bằng chứng tốt". HS và PH không thấy `value` (HCN22-05). Ước lượng **không** tạo quyết định mức đạt (B03).

Thay đổi ngưỡng hoặc trọng số = phiên bản mới `R0@1.1.0`; worker tính lại toàn bộ và giữ bản cũ.

## 5 Hổng gốc

Trên đồ thị cạnh `prerequisite` đã duyệt: với mỗi KC `needs_support`, đi lùi theo tiên quyết cũng `needs_support` (chọn theo thứ tự mã khi có nhiều nhánh) tối đa 3 bước. Kết quả gom theo gốc: `{ root, affected[], capped }`. `capped = true` khi còn tiên quyết yếu sau 3 bước → giao diện GV hiện "Nên trao đổi trực tiếp" (B06). Kết quả không phụ thuộc thứ tự dữ liệu (T03).

## 6 Độ phủ và validator V01–V08

| Mã | Mức | Điều kiện |
|---|---|---|
| V01 | block | YCCĐ trong phạm vi module không có câu hỏi hay tiêu chí nào có KC observable thuộc YCCĐ |
| V02 | caution | YCCĐ Bloom ≥ 5 chỉ được quan sát bằng câu hỏi, không có tiêu chí rubric |
| V03 | caution | Câu practice không có gợi ý |
| V04 | info | Câu chọn đáp án có phương án sai chưa gắn lỗi hiểu sai |
| V05 | block | KC observable chưa được duyệt (kể cả đã superseded) hoặc không thuộc KC của các YCCĐ trong phạm vi; riêng quiz `diagnostic` được quan sát thêm tiên quyết trực tiếp của KC trong phạm vi (`computeCoverage(draft, reqKcs, approvedKcs, prereqKcs)`) |
| V06 | caution | KC tiên quyết ngoài lớp chưa có học liệu ôn trong thư viện (M10) |
| V07 | block | Câu do AI soạn chưa có người duyệt |
| V08 | caution | Tiêu chí rubric không gắn KC |

`block` chặn publish (422 `COVERAGE_BLOCKED`). `caution` cần lý do trong `acknowledgements`. `info` chỉ hiển thị.

## 7 Hồ sơ học sinh

`GET /learners/{id}/records` ghép ba lớp, **không cộng dồn**:

- **Hoạt động**: số mục có `completion_rule ≠ none` đã `completed` / tổng trong các release của offering.
- **Quyết định mức đạt**: với mỗi YCCĐ trong các module đã giao, quyết định hiện hành (`attainment_current`) và lịch sử; chưa có → "Chưa có kết luận" (không phải "chưa đạt").
- **Minh chứng**: danh sách review đã công bố dẫn tới quyết định.

Nhu cầu (ước lượng) ở endpoint riêng `/needs`. Giao diện dùng nhãn khác nhau cho ba lớp và luôn ghi "cập nhật lúc…".

## 8 Bản đồ nhiệt

**Chốt ở 3.7:** cột = KC có version `approved` hiện hành, liên kết `approved` tới YCCĐ của các module version đã giao cho offering; thứ tự tô-pô trên `effective_kc_edges` loại `prerequisite` (tie-break theo mã KC). Hàng = HS ghi danh `active`. Ô = `needs_current_kc` với `R0_MODEL_VERSION`; không có → `insufficient` (không phải 0). GV có phân công thấy `value` khi bật; HS không gọi được heatmap. Kèm `rootGaps` theo docs/06 mục 5 cho từng HS (nhóm theo gốc, `capped` → "Nên trao đổi trực tiếp"). `lastUpdatedAt` = `computed_at` lớn nhất trong các ô.


`GET /offerings/{id}/heatmap`: hàng là HS đang ghi danh, cột là KC version đã duyệt thuộc các YCCĐ của module đã giao, sắp theo thứ tự tô-pô của đồ thị tiên quyết (tie-break theo mã). Ô = trạng thái `needs_current` với `model_version` hiện hành; không có ước lượng → `insufficient`. Có `lastUpdatedAt`.
