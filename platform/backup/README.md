# 客戶資料備份（雲端＋本機）

所有客戶共用同一個 Supabase 資料庫（用 `shop_id` 分開）。這套工具每天把**每一家客戶**的資料各自匯出一份：

- **雲端**：私人 GitHub repo `client-backups`，GitHub Actions 每天台北時間凌晨 3:17 自動跑，結果 commit 回 repo。
- **本機**：Mac 每天早上 9:07 自動把那個 repo 同步到 `~/客戶資料備份`。

```
data/
  README.md                 ← 最後備份日期、每家客戶總筆數
  qingjin/
    latest/                 ← 每天覆蓋的最新一份
      tickets.csv / .json   ← 每張資料表一份 CSV（Excel 直接開）＋ JSON（還原用）
      manifest.md           ← 這次備份了幾筆
    archive/2026-11/        ← 每月 1 號的存檔
  <下一家客戶>/
```

要找某一天的資料：看 `data/<客戶>/latest` 的 git 歷史，每天一個 commit。
要把資料交給客戶：把 `data/<客戶>/` 整個資料夾打包給他。

不備份 `shop_secrets` / `platform_secrets`（密碼雜湊值）。
以後新行業的系統只要資料表有 `shop_id` 欄位，就會自動被備份，不用改程式。

---

## 第一次設定（只做一次，約 10 分鐘）

### 1. 在 GitHub 開一個私人 repo
GitHub → 右上角 **+** → **New repository** → 名稱 `client-backups` → 選 **Private** → Create。

### 2. 把這個資料夾的檔案放進去
把 `platform/backup/` 裡的檔案（包含 `.github/` 和 `.gitignore`）全部放到新 repo 的最上層並推上去。
（或在 Claude Code 把 `client-backups` 加進對話，請 Claude 幫你放。）

### 3. 設定資料庫連線（Secret）
1. Supabase 後台 → 專案 → **Project Settings → Database → Connection string → URI**，
   把 `[YOUR-PASSWORD]` 換成資料庫密碼（建立專案時設定的那組，不是店內/店長 PIN）。
2. GitHub `client-backups` → **Settings → Secrets and variables → Actions → New repository secret**
   - Name：`SUPABASE_DB_URL`
   - Secret：上一步的整串連線字串

### 4. 先手動跑一次
`client-backups` → **Actions** → 「每日客戶資料備份」→ **Run workflow**。
跑完（約 1 分鐘）repo 裡就會出現 `data/` 資料夾。之後每天自動跑。

### 5. 設定本機同步（Mac）
這台 Mac 要先能存取私人 repo（例如安裝 GitHub Desktop 並登入一次）。然後打開「終端機」，貼上：

```bash
git clone https://github.com/za50132/client-backups.git /tmp/cb-setup
bash /tmp/cb-setup/local/install-mac.sh https://github.com/za50132/client-backups.git
```

完成後備份會出現在 `~/客戶資料備份`，每天早上 9:07（電腦有開著時）自動更新，
同步紀錄在 `~/客戶資料備份/.sync.log`。

---

## 其他

- **本機直接從資料庫匯出**（不經過 GitHub）：
  `cp .env.local.example .env.local`，填好密碼後 `npm install && node backup.mjs ~/某個資料夾`
- **GitHub 備份失敗**：GitHub 會寄信通知；到 Actions 頁看紅色那次的紀錄。
  最常見是資料庫密碼改了，回到第 3 步更新 Secret。
- **Supabase 免費方案閒置太久會暫停**：暫停期間備份會失敗（GitHub 會寄信），到 Supabase 後台按 Restore 即可。
