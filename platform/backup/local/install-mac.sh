#!/bin/bash
# 在 Mac 上設定「每天自動把備份同步到本機」。只要跑一次：
#   bash install-mac.sh git@github.com:<你的帳號>/client-backups.git
# 之後每天早上 9:07（電腦有開機時）自動同步到 ~/客戶資料備份
set -euo pipefail
REPO_URL="${1:?請在後面加上備份 repo 的網址，例如 https://github.com/za50132/client-backups.git}"
DIR="$HOME/客戶資料備份"
LABEL="com.clientbackups.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$DIR/.git" ]; then
  git clone "$REPO_URL" "$DIR"
fi
cp "$HERE/sync.sh" "$DIR/.sync.sh"
chmod +x "$DIR/.sync.sh"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/.sync.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>7</integer></dict>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "完成：備份會每天同步到 $DIR（紀錄在 $DIR/.sync.log）"
