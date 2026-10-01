#!/usr/bin/env bash
# Hàm dùng chung cho entry. Không chứa bí mật.
set -euo pipefail

hcn_log() {
  mkdir -p /var/log/hcn-staging 2>/dev/null || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> /var/log/hcn-staging/entry.log || true
}
