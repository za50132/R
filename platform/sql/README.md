# 平台共用資料表

所有客戶、所有系統共用同一個 Supabase 專案（`bjkpwljxvvobkgsyxkpy`）。這裡的 SQL 依編號順序套用，都可以重複執行。

| 檔案 | 內容 |
|---|---|
| `001_clients_events.sql` | **客戶名冊** `clients`、**共用使用紀錄** `events`、`track_event()`；叫號系統的客人頁開啟與店內操作自動同步進 `events` |
| `002_systems.sql` | **系統目錄** `systems`（叫號看號 `queue`、仙杜瑞拉 `cinderella`） |

## 規則

- **客戶代號**：小寫英文開頭，小寫英文／數字，用 `-` 連接，例：`cut-xxx`、`nail-xxx`。決定後不改、不重複使用。請進沿用舊代號 `qingjin`。
- **新系統的資料表**：一定要有 `client_id` 欄位並 `references clients(id)`，打錯代號會被資料庫拒絕，備份也會自動包含。
- **使用紀錄**：網頁上的客人行為呼叫 `track_event(客戶代號, 系統代號, 事件, 訪客代號, 來源, 補充資料)`；店內操作在資料庫函式裡直接寫進 `events`。
- `clients`、`systems`、`events` 外部都讀不到，只有透過 Supabase 連接器、報表與備份看得到。
