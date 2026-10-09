# 備份腳本

Supabase 免費方案沒有內建自動每日備份（那是 Pro 以上才有），所以用這支腳本自己定期匯出。

## 第一次設定

```bash
cd quickcut/scripts
npm install
cp .env.local.example .env.local
# 編輯 .env.local，填入 Supabase 的資料庫密碼（見檔案裡的說明）
```

## 執行備份

```bash
cd quickcut/scripts
npm run backup
```

每次執行會在 `_backups/` 底下產生一份 `backup-YYYY-MM-DD.tar.gz`，裡面是 shops、
designers、tickets、days_off、call_log、page_views 六張表的 JSON + CSV，還有一份
`manifest.md` 摘要報告。自動保留最近 12 份（約 3 個月），更舊的會自動刪除。

不備份 `shop_secrets`（密碼雜湊值）——備份是拿來看資料、救資料用，密碼忘記了走系統
本身的「改密碼」流程即可。

## 排程

建議排程每週跑一次（例如 macOS 用 `launchd`，或手動找時間跑）。`_backups/` 已經加進
`.gitignore`，備份檔不會進版控，自己另外存一份到雲端硬碟或外接硬碟比較保險。
