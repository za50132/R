# 請進 快剪｜線上看號

客人掃 QR Code 就能即時看到「目前叫到幾號」、每位設計師的狀態和休假；
設計師用手機、店長用 Apple Watch 按「下一位」。

| 頁面 | 網址 | 誰用 |
|---|---|---|
| 客人頁 | `https://你的網址/` | 客人掃 QR Code |
| 操作頁 | `https://你的網址/staff.html` | 設計師（店內密碼）、店長（店長密碼） |
| Apple Watch 捷徑 | — | 店長江江 |

> 這套系統**不取代**店裡的抽號機：客人照樣在機器抽號、付錢，
> 線上只負責「看號」，所以號碼永遠以機器為準。

---

## 先試玩（不用任何設定）

`config.js` 的 `supabaseUrl` 留空時是**示範模式**，資料只存在這台電腦的瀏覽器。

1. 用電腦打開 `index.html`（客人頁）
2. 同一個瀏覽器再開一個分頁 `staff.html`（操作頁）
3. 店內密碼 `111111`、店長密碼 `999999`
4. 在操作頁按「下一位」，客人頁會立刻跟著變

> 有些瀏覽器直接雙擊檔案打開會擋掉分頁同步，可以在資料夾裡執行 `npx serve .`，再用 `http://localhost:3000` 開。

---

## 正式上線（約 20 分鐘）

### 第 1 步：申請 Supabase（存號碼的雲端資料庫，免費）

1. 到 <https://supabase.com> 用**你自己的 Email** 註冊，按 **New project**
   - Name：`qingjin`
   - Region：選 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**，離台灣近比較快
   - 資料庫密碼自己設一組，記起來
2. 建好後，左邊選單 **SQL Editor** → **New query**
3. 打開本資料夾的 `supabase/setup.sql`，**先改最上面的兩組密碼**（至少 6 位數字）：
   ```sql
   '111111'::text  as staff_pin,   -- ★ 店內密碼（設計師共用）
   '999999'::text  as owner_pin;   -- ★ 店長密碼
   ```
4. 整份貼進 SQL Editor，按 **Run**，看到 `Success` 就完成了
5. 左邊選單 **Project Settings → API Keys**（或 **Data API**），複製兩個值：
   - **Project URL**：像 `https://abcdefgh.supabase.co`
   - **Publishable key**（或舊版的 **anon public** key）：這把是設計給網頁公開使用的，放進網頁沒關係
   - ⚠️ **不要**複製 `service_role` / `secret` 那一把

### 第 2 步：填入 config.js

```js
supabaseUrl: 'https://abcdefgh.supabase.co',
supabaseKey: '剛剛複製的 publishable / anon key',
```

### 第 3 步：放上 Netlify（免費網址）

**方法 A：拖拉上傳（最簡單）**
1. 到 <https://app.netlify.com> 註冊登入
2. **Add new site → Deploy manually**
3. 把整個 `quickcut` 資料夾拖進去
4. **Site configuration → Change site name** 改成 `qingjin`，網址就是 `https://qingjin.netlify.app`

**方法 B：連 GitHub（之後改程式會自動更新）**
1. **Add new site → Import an existing project** → 選這個 repo
2. **Base directory** 填 `quickcut`，**Publish directory** 填 `quickcut`（或留空），Build command 留空
3. 一樣把 site name 改成 `qingjin`

> 建議抽號系統用**獨立的 Netlify 帳號**，跟處方葉官網分開。免費額度用完時，整個帳號的網站都會被暫停，分開比較安全。

### 第 4 步：店內設定

1. 每位設計師用手機打開 `https://qingjin.netlify.app/staff.html`
   - 輸入店內密碼 → 選自己的名字，之後打開就直接進入叫號畫面
   - iPhone：Safari 分享 →「加入主畫面」，就會像 App 一樣
2. 江江進「店長設定」：
   - **排休**：選設計師 → 點日期
   - **QR Code**：截圖或列印，貼在店門口、抽號機旁邊
   - **Apple Watch 捷徑設定資料**：下一步要用

---

## Apple Watch 捷徑（江江用）

一個捷徑 = 手錶上的一顆按鈕。建議做這 3 個：

| 捷徑名稱 | `p_action` | 用途 |
|---|---|---|
| 下一位 | `next` | 叫下一號（4 秒內連按只算一次） |
| 休息 | `toggle_break` | 休息／回來切換 |
| 目前號碼 | `status` | 查詢全店和每位設計師的號碼 |

（另外還有 `undo` 退回上一位、`call` 叫指定號碼，可以視需要再加。）

### 建立「下一位」捷徑

在 **iPhone** 的「捷徑」App：

1. 右上角 **＋** 建立新捷徑，名稱改成「下一位」
2. 加入動作，搜尋 **「取得 URL 內容」**
3. URL 貼上：操作頁「店長設定 → Apple Watch 捷徑設定資料」裡的網址
   （`https://xxxx.supabase.co/rest/v1/rpc/staff_action`）
4. 點「顯示更多」：
   - **方法**：`POST`
   - **標頭**：新增兩個
     - `apikey` ＝ 你的 publishable / anon key
     - `Content-Type` ＝ `application/json`
   - **要求本文**：選 **JSON**，新增 4 個欄位（類型都選「文字」）：

     | 鍵 | 值 |
     |---|---|
     | `p_shop` | `qingjin` |
     | `p_pin` | 店內密碼 |
     | `p_designer` | `jiang` |
     | `p_action` | `next` |
5. 再加入動作 **「取得字典值」**：取得 `message` 的值
6. 再加入動作 **「顯示通知」**（或「顯示結果」），內容選上一步的「字典值」
7. 點捷徑下方的 ⓘ，打開 **「在 Apple Watch 上顯示」**

「休息」「目前號碼」捷徑：複製「下一位」捷徑，只把 `p_action` 改成 `toggle_break` / `status`。

### 叫指定號碼（選用）

1. 第一個動作加 **「要求輸入」**，類型選 **數字**，提示寫「號碼」
2. JSON 多一個欄位 `p_number`，**類型選「數字」**，值選「提供的輸入」
3. `p_action` 改成 `call`

### 放到手錶錶面

Apple Watch 長按錶面 → **編輯** → 複雜功能 → 選 **捷徑** → 選「下一位」。
之後抬手點一下就叫號，手錶會顯示「江江 叫號 024」。
也可以說「**嘿 Siri，下一位**」。

> 捷徑裡存著店內密碼，**不要把捷徑分享給別人**。如果手錶遺失，到「店長設定」改店內密碼即可。

---

## 日常使用

- **每天自動歸零**：每天第一次按「下一位」時，自動從 001 開始。不用手動歸零。
- **跟機器對不上**：店長設定 →「修改目前叫號」。
- **按錯**：按「↶ 退回」。如果之後沒有別人叫號，全店號碼也會一起退回。
- **指定設計師的客人**：用「叫指定號碼」，輸入他手上的號碼。
- **老闆休假**：其他設計師照常用自己的手機叫號，上方可以切換設計師，幫別人操作。
- **密碼打錯 10 次**：鎖 10 分鐘。

## 改店家資料

全部在 `config.js`：營業時間、電話、地址、設計師班表。
**新增或刪除設計師**時，`config.js` 和 `supabase/setup.sql` 底部的設計師名單要**一起改**，再到 SQL Editor 執行一次 `setup.sql`（不會清掉既有資料）。

## 數據（第二階段用）

每一次叫號都會記錄在 `call_log` 資料表（時間、設計師、號碼），只有在 Supabase 後台看得到，客人讀不到。
累積 4～8 週之後，就能分析每天、每小時的來客數，找出冷門時段。

## 用量與費用

一間店每天約 300 人的規模，Supabase 和 Netlify 的**免費方案都夠用**。

- Supabase 免費專案**閒置 7 天會暫停**（店家每天使用就不會觸發）。
- 正式營運建議升級 Supabase Pro（有每日備份）。

## 檔案說明

```
quickcut/
├── index.html          客人頁
├── staff.html          操作頁（設計師＋店長設定）
├── config.js           店家資料、班表、Supabase 連線 ← 主要改這裡
├── css/app.css         樣式（招牌配色）
├── js/common.js        台北時間、班表狀態
├── js/store.js         資料同步（Supabase／示範模式）
├── js/customer.js      客人頁
├── js/staff.js         操作頁
├── supabase/setup.sql  資料庫設定（貼到 Supabase SQL Editor 執行）
├── img/                Logo、手機主畫面圖示
└── manifest.webmanifest
```
