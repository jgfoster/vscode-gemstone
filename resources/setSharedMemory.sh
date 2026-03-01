#!/bin/bash
# Configure macOS shared memory for GemStone/S 64 Bit
# Run with: sudo ./setSharedMemory.sh
# Requires a restart to take effect.

set -e

PLIST_PATH="/Library/LaunchDaemons/com.gemtalksystems.shared-memory.plist"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root. Use: sudo $0"
  exit 1
fi

cat > "$PLIST_PATH" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
"http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>shmemsetup</string>
  <key>UserName</key>
  <string>root</string>
  <key>GroupName</key>
  <string>wheel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/sbin/sysctl</string>
    <string>kern.sysv.shmmax=4294967296</string>
    <string>kern.sysv.shmall=1048576</string>
  </array>
  <key>KeepAlive</key>
  <false/>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"

echo "Shared memory plist installed at $PLIST_PATH"
echo "Please restart your computer for the changes to take effect."
