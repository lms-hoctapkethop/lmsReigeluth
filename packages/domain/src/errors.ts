export const errorCodes = [
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_FAILED',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'REQUEST_IN_PROGRESS',
  'SUBMISSION_VERSION_CHANGED',
  'ALREADY_PUBLISHED',
  'ATTEMPT_LIMIT_REACHED',
  'RELEASE_CLOSED',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'VALIDATION_FAILED',
  'COVERAGE_BLOCKED',
  'FEATURE_NOT_ENABLED',
  'KC_EDGE_CYCLE',
  'FILE_NOT_SCANNED',
  'RATE_LIMITED',
  'INTERNAL',
] as const

export type ErrorCode = (typeof errorCodes)[number]

const statusByCode: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_PROGRESS: 409,
  SUBMISSION_VERSION_CHANGED: 409,
  ALREADY_PUBLISHED: 409,
  ATTEMPT_LIMIT_REACHED: 409,
  RELEASE_CLOSED: 410,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_NOT_ALLOWED: 415,
  VALIDATION_FAILED: 422,
  COVERAGE_BLOCKED: 422,
  FEATURE_NOT_ENABLED: 422,
  KC_EDGE_CYCLE: 422,
  FILE_NOT_SCANNED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

const messageByCode: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Yêu cầu không đọc được.',
  UNAUTHENTICATED: 'Bạn cần đăng nhập.',
  FORBIDDEN: 'Bạn không có quyền thực hiện việc này.',
  CSRF_FAILED: 'Yêu cầu bị từ chối.',
  NOT_FOUND: 'Không tìm thấy.',
  REVISION_CONFLICT: 'Nội dung đã được sửa ở nơi khác.',
  IDEMPOTENCY_KEY_REUSED: 'Khóa thử lại đã dùng cho một nội dung khác.',
  REQUEST_IN_PROGRESS: 'Yêu cầu đang được xử lý.',
  SUBMISSION_VERSION_CHANGED: 'Bài nộp đã có phiên bản mới.',
  ALREADY_PUBLISHED: 'Nội dung đã được phát hành.',
  ATTEMPT_LIMIT_REACHED: 'Đã hết lượt làm.',
  RELEASE_CLOSED: 'Bài đã đóng.',
  FILE_TOO_LARGE: 'Tệp quá lớn.',
  FILE_TYPE_NOT_ALLOWED: 'Loại tệp không được phép.',
  VALIDATION_FAILED: 'Dữ liệu không hợp lệ.',
  COVERAGE_BLOCKED: 'Độ phủ chưa đủ để phát hành.',
  FEATURE_NOT_ENABLED: 'Chức năng chưa được bật.',
  KC_EDGE_CYCLE: 'Cạnh này tạo thành vòng.',
  FILE_NOT_SCANNED: 'Tệp chưa được quét xong.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Hãy thử lại sau.',
  INTERNAL: 'Đã có lỗi. Hãy thử lại.',
}

export class DomainError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(messageByCode[code])
    this.name = 'DomainError'
    this.code = code
    this.statusCode = statusByCode[code]
    if (details) this.details = details
  }
}
