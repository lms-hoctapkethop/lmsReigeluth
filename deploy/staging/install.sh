#!/usr/bin/env bash
# Ops chạy bằng root từ một bản checkout. Idempotent.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "install.sh cần root" >&2
  exit 1
fi
src="$(cd "$(dirname "$0")" && pwd)"
apt-get update
apt-get install -y jq zstd
id hcndeploy >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin hcndeploy
install -d -o root -g root -m 0755 /opt/hcn-staging/bin /opt/hcn-staging/bin/lib /opt/hcn-staging/releases /opt/hcn-staging/env
install -d -o root -g root -m 0700 /opt/hcn-staging/secrets
install -d -o root -g root -m 0755 /var/lib/hcn-staging/metrics /var/log/hcn-staging
install -m 0755 "$src/bin/hcn-staging" /opt/hcn-staging/bin/hcn-staging
install -m 0755 "$src/bin/policy-check.sh" /opt/hcn-staging/bin/policy-check.sh
install -m 0755 "$src/preflight.sh" /opt/hcn-staging/bin/preflight.sh
install -m 0644 "$src/bin/lib/common.sh" /opt/hcn-staging/bin/lib/common.sh
if [[ ! -e /opt/hcn-staging/env/staging.env ]]; then
  cat > /opt/hcn-staging/env/staging.env <<'EOF'
APP_DOMAIN=staging-lms.hoctapkethop.edu.vn
ID_DOMAIN=id-staging-lms.hoctapkethop.edu.vn
GUARD_URL=https://lms.hoctapkethop.edu.vn/
ACME_EMAIL=ops@example.edu.vn
EOF
  chmod 600 /opt/hcn-staging/env/staging.env
fi
"$src/init-secrets.sh" /opt/hcn-staging/secrets
cat > /etc/sudoers.d/hcn-staging <<'EOF'
hcndeploy ALL=(root) NOPASSWD: /opt/hcn-staging/bin/hcn-staging
EOF
chmod 440 /etc/sudoers.d/hcn-staging
visudo -cf /etc/sudoers.d/hcn-staging
install -m 0644 "$src/systemd/hcn-staging-backup.service" /etc/systemd/system/hcn-staging-backup.service
install -m 0644 "$src/systemd/hcn-staging-backup.timer" /etc/systemd/system/hcn-staging-backup.timer
install -m 0644 "$src/systemd/hcn-staging-backup-full.service" /etc/systemd/system/hcn-staging-backup-full.service
install -m 0644 "$src/systemd/hcn-staging-backup-full.timer" /etc/systemd/system/hcn-staging-backup-full.timer
install -m 0644 "$src/systemd/hcn-staging-backup-files.service" /etc/systemd/system/hcn-staging-backup-files.service
install -m 0644 "$src/systemd/hcn-staging-backup-files.timer" /etc/systemd/system/hcn-staging-backup-files.timer
systemctl daemon-reload
systemctl enable --now hcn-staging-backup.timer hcn-staging-backup-full.timer hcn-staging-backup-files.timer
echo "install ok. Ops chạy stanza-create sau lần deploy đầu."
