#!/bin/bash
# Configure systemd to preserve GemStone shared memory on session logout.
# Without this, systemd destroys shared memory (and kills the Stone) when the
# session that started it logs out.
# Run with: sudo ./setRemoveIPC.sh

set -e

CONF_DIR="/etc/systemd/logind.conf.d"
CONF_FILE="$CONF_DIR/gemstone.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo $0"
  exit 1
fi

mkdir -p "$CONF_DIR"

cat > "$CONF_FILE" <<'EOF'
[Login]
RemoveIPC=no
EOF

echo "Configured at $CONF_FILE"
echo "To apply: restart your computer, or run: sudo systemctl restart systemd-logind"
