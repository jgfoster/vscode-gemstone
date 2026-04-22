#!/bin/bash
# Add `gs64ldi 50377/tcp` to /etc/services inside the Linux distro so
# startnetldi binds to the conventional GemStone port and logins can
# name the port as "gs64ldi". Idempotent.
#
# Run with: sudo ./setServicesLinux.sh

set -e

SERVICES="/etc/services"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo $0"
  exit 1
fi

if grep -qE '^\s*gs64ldi\s+[0-9]+/tcp\b' "$SERVICES"; then
  echo "$SERVICES already has a gs64ldi entry; no change made."
else
  # Preserve a trailing newline if present.
  tail -c1 "$SERVICES" | read -r _ || echo "" >> "$SERVICES"
  printf 'gs64ldi\t\t50377/tcp\t\t# GemStone/S NetLDI\n' >> "$SERVICES"
  echo "Added 'gs64ldi 50377/tcp' to $SERVICES."
fi
