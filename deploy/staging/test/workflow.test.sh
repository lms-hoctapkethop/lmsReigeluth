#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
python3 - "$root" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
files = sorted((root / ".github/workflows").glob("*.yml"))
bad = []
for path in files:
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if "secrets." not in line:
            continue
        if re.search(r":\s*\$\{\{\s*secrets\.", line):
            continue
        if re.search(r"\$\{\{\s*secrets\.", line):
            bad.append(f"{path.relative_to(root)}:{number}:{line.strip()}")
if bad:
    print("secret bị chèn vào thân script:", file=sys.stderr)
    print("\n".join(bad), file=sys.stderr)
    raise SystemExit(1)
deploy = (root / ".github/workflows/deploy-staging.yml").read_text(encoding="utf-8")
for needle in (
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
    "git merge-base --is-ancestor",
):
    if needle not in deploy:
        print(f"deploy-staging thiếu {needle}", file=sys.stderr)
        raise SystemExit(1)
print("workflow.test ok")
PY
