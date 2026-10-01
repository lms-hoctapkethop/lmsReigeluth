export const needLabels = {
  insufficient: 'Chưa đủ bằng chứng',
  needs_support: 'Cần hỗ trợ',
  developing: 'Đang phát triển',
  strong: 'Có bằng chứng tốt',
} as const

export type NeedStatus = keyof typeof needLabels
