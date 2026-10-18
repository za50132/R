#!/bin/bash
# 本機備份：把 GitHub 上的備份 repo 同步到這台電腦。
# 由 launchd 每天自動執行（見 install-mac.sh），也可以手動跑：bash sync.sh
set -euo pipefail
DIR="${BACKUP_DIR:-$HOME/客戶資料備份}"
LOG="$DIR/.sync.log"
cd "$DIR"
{
  echo "=== $(date '+%F %T') 開始同步"
  git pull --ff-only
  echo "=== $(date '+%F %T') 完成：$(git log -1 --format='%s（%cd）' --date=format:'%F %R')"
} >> "$LOG" 2>&1
