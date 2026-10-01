#!/usr/bin/env bash
# Khói từ runner, qua Cloudflare. Không in bí mật.
set -euo pipefail
: "${APP_DOMAIN:?}"
: "${ID_DOMAIN:?}"
base="https://${APP_DOMAIN}"
idbase="https://${ID_DOMAIN}"
probe=()
if [[ -n "${STAGING_PROBE_TOKEN:-}" ]]; then
  probe=(-H "X-HCN-Probe: ${STAGING_PROBE_TOKEN}")
fi
curl -fsS "${probe[@]}" "${base}/health/ready"
curl -fsSI "${probe[@]}" "${base}/" | grep -i 'content-security-policy'
code="$(curl -s -o /dev/null -w '%{http_code}' "${probe[@]}" "${base}/api/v1/me")"
[[ "$code" == "401" ]]
code="$(curl -s -o /dev/null -w '%{http_code}' "${probe[@]}" "${base}/metrics")"
[[ "$code" == "404" ]]
code="$(curl -s -o /dev/null -w '%{http_code}' "${probe[@]}" "${idbase}/admin/")"
[[ "$code" == "404" ]]
code="$(curl -s -o /dev/null -w '%{http_code}' "${probe[@]}" "${idbase}/realms/master/")"
[[ "$code" == "404" ]]
echo "khói curl đạt"
