# 一起出遊 🏕️ — 品項認領 & 金流結算

> 無伺服器・無資料庫 · 用 Google Sheets 當後端，完全免費

---

## 快速開始（約 15 分鐘）

### Step 1：部署 Google Apps Script 後端

1. 開啟 [script.google.com](https://script.google.com)
2. 點「新增專案」
3. 刪除預設程式碼，將 Code.gs 的全部內容貼入
4. 點選上方「部署」→「新增部署作業」
5. 類型選「**網頁應用程式**」
6. 設定：
   - 執行身分：**我（你的 Google 帳號）**
   - 存取權：**所有人**
7. 點「部署」，完成 Google 授權
8. **複製產生的 Web App URL**（格式：https://script.google.com/macros/s/xxx/exec）

> ⚠️ 第一次部署後，Google 會自動在你的雲端硬碟建立一個「一起出遊 — 資料庫」試算表

---

### Step 2：維護者設定前端（只需一次）

1. 開啟 `app-config.js`，設定各前端網域對應的 Apps Script Web App URL。
2. 將 `index.html`、`app-config.js`、`manifest.webmanifest` 與完整的 `icons` 資料夾一起上傳到靜態網站。
3. 一般使用者直接開啟網站或分享連結即可使用，**不需要** Google 帳號、Apps Script 或 API 設定。

> 維護者若要測試或暫時改用另一組 API，可在網址後加上 `?setup=1` 開啟設定頁；這只影響自己的瀏覽器。

> 從活動連結加入手機主畫面時，PWA 會以當下包含活動代碼的網址作為啟動頁；更新 Manifest 後，既有的主畫面捷徑需移除並重新加入才會套用。

---

## 使用流程

### 主揪（建立活動）
1. 點「✨ 建立新活動」
2. 可選填 3～24 位英數活動代碼（會轉為大寫）；留空則自動產生
3. 輸入活動名稱、新增所有成員名字；品項可先留白，之後再於活動內新增
4. 點「🚀 建立活動」
5. 複製分享連結（右上角 🔗 分享按鈕）傳給所有成員

### 成員（認領品項）
1. 打開主揪傳來的連結
2. 在「我是」下拉選單選自己的名字
3. 對要帶的品項點「✋ 我來帶」
4. 若有人已付款，在付款人選下拉選自己，並輸入金額
5. 點「💾 儲存付款人 / 金額」

### 安排行程
1. 在「📅 行程表」點「＋ 新增行程」
2. 為日期區段新增行程，填入時間、地點、內容；可附上 Google Maps 等地點連結
3. 行程會依日期分段、按時間排序；跨日活動可直接在同一個活動中管理

### 查看結算
1. 點上方「💰 金流結算」分頁
2. 查看總支出、每人均攤金額
3. 「付款方式」區塊顯示最少次數的匯款清單

---

## 結算邏輯

- 金額以新台幣整元儲存；輸入小數時會**無條件進位**
- 所有費用由指定分攤人平均分攤；無法整除的整元餘額依分攤人順序分配，總額不會產生小數或誤差
- 代墊金額 - 均攤金額 = 餘額
  - 正值 → 收回（別人要付你錢）
  - 負值 → 應付（你要付錢給別人）
- 使用 Greedy 演算法，將付款次數最小化

**範例：**
| 成員 | 代墊 | 均攤 | 收/付 |
|------|------|------|-------|
| 小明 | ,200 |  | 收回  |
| 小華 |  |  | 收回  |
| 小陳 |  |  | 應付  |
| 阿婷 |  |  | 應付  |

付款：阿婷 → 小明 ・小陳 → 小明 ・小陳 → 小華 

---

## 架構

`
app-config.js       (依前端網域選擇 master / dev API)
index.html          (前端，可本機直接開啟或部署靜態站台)
manifest.webmanifest、icons/（PWA 安裝資訊與各尺寸圖示）
  │
  │ HTTP (fetch)
  ▼
Google Apps Script  (免費 API，自動建立 Spreadsheet)
  │
  │ SpreadsheetApp
  ▼
Google Sheets       (資料庫，結構化儲存活動與品項資料)
`

### 環境與連線設定

`master` 與 `dev` 共用同一份 `app-config.js`，依 `location.hostname` 自動選擇環境，因此切換或合併 branch 時不需要修改 API URL。

| 環境 | 前端網址 | Apps Script API |
| --- | --- | --- |
| master | `https://trip-planner.tsai212224.workers.dev/` | `AKfycbyg...SZlzk/exec` |
| dev | `https://test.tsai212224.workers.dev/` | `AKfycbxsv...XeR1iQ/exec` |

本機的 `localhost`、`127.0.0.1` 以及未知網域一律使用 dev API，避免測試時誤寫正式資料。

### Google Sheets 資料結構

**activities 工作表（活動索引）**
| activityId | name | members | createdAt | schedule | storageVersion |

**items 工作表（所有活動的品項）**
| activityId | itemId | name | claimers | payer | amount | sharers | updatedAt | amountSet |

---

## 部署到靜態站台（可選）

取得固定網址，方便分享：

**Cloudflare Pages（推薦，免費）**
1. 把 `index.html`、`app-config.js`、`manifest.webmanifest` 與 `icons` 資料夾上傳到 GitHub Repo
2. 到 [pages.cloudflare.com](https://pages.cloudflare.com) 連結 Repo
3. 部署後取得 xxx.pages.dev 網址

**GitHub Pages（免費）**
1. 在 GitHub 建立 Repo，上傳 `index.html`、`app-config.js`、`manifest.webmanifest` 與 `icons` 資料夾
2. 到 Repo Settings → Pages → 選擇 Branch
3. 部署後取得 username.github.io/reponame 網址

---

## 注意事項

- Apps Script 單次執行上限為 6 分鐘；實際可用量依 Google 帳號類型與每日配額而異。
- 前端每 30 秒自動同步一次；一般小型群組足夠使用。
- 多人同時編輯同一品項時，後寫者仍可能覆蓋先寫者，請避免同時修改同一欄位。
- 資料集中在固定的 `activities`、`items` 兩張表，不會為每個活動建立新分頁。
- API 是公開 Web App；僅適合受信任的朋友／小型社群，勿用來存放敏感資料。
