#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
entry="$root/deploy/staging/bin/hcn-staging"
for file in "$root"/perf/perf-0{1,2,3,4,5}.js; do
  grep -q 'hostOptions(' "$file"
  if grep -q '__ENV.PASSWORD' "$file"; then
    echo "$file còn mật khẩu qua môi trường" >&2
    exit 1
  fi
  if grep -Eq "get\(\`\\\$\{base\}/(hoc|day)" "$file" || grep -q '/hoc' "$file" || grep -q '/day' "$file"; then
    echo "$file vẫn đo HTML SPA" >&2
    exit 1
  fi
  grep -q 'ok(' "$file"
done
grep -q 'status >= 200 && response.status < 300' "$root/perf/lib/session.js"
grep -q 'hosts:' "$root/perf/lib/session.js"
grep -q "open('/secrets/synthetic_user_password')" "$root/perf/lib/login.js"
grep -q 'hcn_sid' "$root/perf/lib/login.js"
grep -q 'action=' "$root/perf/lib/login.js"
grep -q '/api/v1/me' "$root/perf/perf-01.js"
grep -q '/api/v1/me/today' "$root/perf/perf-01.js"
grep -q 'module-releases' "$root/perf/perf-01.js"
grep -q 'submission/draft' "$root/perf/perf-02.js"
grep -q '/submissions' "$root/perf/perf-03.js"
grep -q '/attempts' "$root/perf/perf-04.js"
grep -q 'heatmap' "$root/perf/perf-05.js"
grep -q 'review-queue' "$root/perf/perf-05.js"
grep -q 'summary-export' "$entry"
grep -q 'docker logs' "$entry"
if grep -q -- '-e PASSWORD' "$entry" || grep -q -- '--host' "$entry"; then
  echo "entry perf còn -e PASSWORD hoặc --host" >&2
  exit 1
fi
image="$(grep -E '^grafana/k6:' "$root/deploy/staging/images.lock" | head -n 1)"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  help="$(mktemp)"
  docker run --rm --entrypoint k6 "$image" run --help >"$help"
  if grep -Eq '^[[:space:]]*-?-host([[:space:]]|$)' "$help"; then
    echo "image k6 có cờ --host; script vẫn chỉ dùng options.hosts" >&2
  fi
  rm -f "$help"
fi
echo "perf-scripts.test ok"
