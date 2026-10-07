# 請進 快剪｜線上叫號（簡單版）

最簡單的線上叫號：

- **客人**：掃 QR Code 看目前叫到幾號；輸入自己的號碼牌，快輪到時提醒、輪到時響鈴
- **老闆**：按「下一位」，或「輸入號碼叫號」；另外可以點選預估等待時間
- **Apple Watch**：用 iPhone「捷徑」App 做按鈕，抬手就能叫號

| 頁面 | 網址 | 誰用 |
|---|---|---|
| 客人頁 | `https://你的網址/` | 客人掃 QR Code |
| 叫號頁 | `https://你的網址/staff.html` | 老闆、設計師（輸入密碼） |
| 預覽 | `https://你的網址/preview.html` | 給老闆試按的示範 |

## 網路上存了什麼

**只有一列資料**：目前叫到幾號、上一號（給「退回」用）、預估等待時間。

- 每次叫號都是**直接覆蓋**，不留歷史紀錄
- 不記錄客人資料、不記錄發了幾張號碼、不顯示等候人數
- 每天第一次叫號時自動歸零
- 外人能看到的，跟站在店門口看叫號燈一樣：目前叫到幾號

> 完整版（加號、指定設計師、等候名單、冷熱時段分析）放在 `../quickcut/`，之後要用可以直接換過去。

---

## 先試玩（不用任何設定）

`config.js` 的 `supabaseUrl` 留空時是**示範模式**，資料只存在這台電腦的瀏覽器。
打開 `preview.html`，客人頁、叫號頁、Apple Watch 三個畫面並排而且連動。密碼 `111111`。

> 直接雙擊檔案打開時，有些瀏覽器會擋掉同步。可以在資料夾裡執行 `npx serve .`，再用 `http://localhost:3000/preview.html` 開。

## 正式上線（約 20 分鐘）

1. **Supabase**（存號碼的雲端資料庫，免費）
   - 到 <https://supabase.com> 用**老闆自己的 Email** 註冊，資料就歸老闆所有，隨時可以自己刪除
   - New project → Region 選 **Northeast Asia (Tokyo)**
   - 左邊 **SQL Editor** → 打開 `supabase/setup.sql`，**先改最上面的密碼**（至少 6 位數字）→ 整份貼上 → **Run**
   - **Project Settings → API Keys**：複製 **Project URL** 和 **Publishable key**（或舊版 **anon public**）。⚠️ 不要複製 `service_role` / `secret`
2. **填入 `config.js`**：`supabaseUrl`、`supabaseKey`
3. **Netlify**：<https://app.netlify.com> → **Add new site → Deploy manually** → 把整個 `pager` 資料夾拖進去 → site name 改成 `qingjin`
4. **店內**：老闆手機打開 `https://qingjin.netlify.app/staff.html` 輸入密碼，Safari 分享 →「加入主畫面」；最下面「設定」裡的 QR Code 印出來貼在門口

## 使用方式

- **下一位**：號碼 +1。手錶連按 3 秒內只算一次
- **輸入號碼叫號**：指定設計師的客人、過號的客人回來時，直接輸入號碼
- **↶ 退回**：按錯時退回上一號（只能退一次）
- **預估等待時間**：點「免等／10／20／30／45／60+」。**超過 60 分鐘沒更新，客人頁會自動隱藏**，避免顯示過時的時間
- **密碼打錯 10 次**：鎖 10 分鐘

### 客人的提醒，要先知道的限制

- 客人輸入號碼後，**差 2 號時提醒「快輪到您了」，輪到時響鈴**，畫面會變綠色。差幾號提醒可以在 `config.js` 的 `nearAlert` 調整
- **頁面要開著才會提醒**。iPhone 鎖螢幕或切到別的 App，網頁會被暫停，就不會響。頁面會盡量讓螢幕保持不熄滅，也會提示客人「請讓這個畫面保持開著」
- Android 手機另外會震動；iPhone 的網頁不支援震動

## Apple Watch 捷徑

在 **iPhone** 的「捷徑」App 建立，再到手錶錶面加「捷徑」複雜功能。

| 捷徑 | `p_action` | 說明 |
|---|---|---|
| 下一位 | `next` | 號碼 +1 |
| 輸入號碼 | `call` | 第一個動作加「要求輸入」（數字），JSON 多一個 `p_number`（類型選數字）＝提供的輸入 |
| 等待時間 | `set_wait` | 第一個動作加「從選單中選擇」：免等、10、20、30、45、60+，各自接一個「數字」動作（免等＝0、60+＝60），JSON 的 `p_number` 用這個數字 |
| 退回 | `undo` | 退回上一號 |

每個捷徑的做法：

1. 加入動作 **「取得 URL 內容」**
   - URL：`https://你的專案.supabase.co/rest/v1/rpc/pager_action`
   - 方法：`POST`
   - 標頭：`apikey` ＝ publishable / anon key；`Content-Type` ＝ `application/json`
   - 要求本文（JSON）：`p_shop` ＝ `qingjin`、`p_pin` ＝ 密碼、`p_action` ＝ 上表
2. 加入動作 **「取得字典值」**：`message`
3. 加入動作 **「顯示通知」**，內容選上一步的字典值
4. 捷徑設定打開 **「在 Apple Watch 上顯示」**

叫號頁最下面「設定 → Apple Watch 捷徑設定資料」會列出要貼的網址和內容。

> 捷徑裡存著密碼，**不要把捷徑分享給別人**。手錶遺失時，到叫號頁「設定」改密碼即可。

## 檔案說明

```
pager/
├── index.html          客人頁
├── staff.html          叫號頁
├── preview.html        示範：三個畫面並排連動
├── config.js           店家資料、Supabase 連線 ← 主要改這裡
├── css/app.css         樣式
├── js/pager.js         共用：時間、資料同步（Supabase／示範模式）
├── js/customer.js      客人頁
├── js/staff.js         叫號頁
├── supabase/setup.sql  資料庫設定
└── img/                Logo、手機主畫面圖示
```
