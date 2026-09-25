# 一起旅行 ✈️

`feature/旅遊用途` 是以純旅遊規劃為目的的 Apps Script 版本，包含：

- 慾望清單：標題、詳細內容、多組自訂連結、Google Drive 圖片、建立者、編輯／刪除與拖曳排序；清單顯示詳細內容前 50 字，卡片上的連結與照片可直接開啟。
- 行程表：選擇開始與結束日期即可一次建立整段旅遊日期；各日期下新增、編輯或刪除行程，並依時間排序。日期本身也可經確認後刪除，該日行程會一併移除。
- 記帳：一筆費用可同時記錄多個幣別等值金額，指定代墊人、分攤人與結算幣別，卡片可再編輯或刪除。
- 金流結算：保留最少付款次數、個人總額、代墊與品項明細，並讓不同幣別各自計算。
- 活動轉盤：建立旅程時可選擇啟用；啟用後會顯示浮動轉盤按鈕，每位成員的格數與中選機率完全相同。
- 手機版：日期按鈕自動換行，表單具備完整欄位標題，彈窗支援動態視窗高度與安全區域，並修正 iOS 原生日期／時間輸入框超出彈窗的問題。

## Apps Script 分層

雖然 Apps Script 使用 JavaScript，`Code.gs` 依照 Java 後端習慣分層：

```text
doGet / doPost
      ↓
TravelController       // 類似 @RestController
      ↓
TravelService          // 類似 @Service，負責案例流程與驗證
SettlementService      // 領域計算服務
      ↓
TravelRepository       // 類似 @Repository，封裝 Google Sheets
      ↓
Google Sheets / Drive
```

資料分成 `trips`、`wishlist`、`itinerary`、`expenses` 四張工作表。圖片實體放在 Google Drive，Sheet 只保存網址。後端會自動在既有 Sheet 尾端補上 `rouletteEnabled`、`details`、`links` 等新欄位，不需手動改欄位順序。

建立旅程時，成員採逐筆新增的標籤模式，可按 Enter 或「新增」加入，也可用標籤上的 × 移除。幣別提供常用資料建議；輸入 `KRW` 或「韓幣」會自動補齊 `KRW／韓幣／₩`，未收錄的幣別仍可自行填寫。

## 部署

1. 建議建立一個全新的「旅遊版」Apps Script 專案，再貼上 [Code.gs](./Code.gs)，避免沿用舊版的 `SPREADSHEET_ID` 與資料庫。
2. 部署為網頁應用程式，執行身分選擇自己，存取權設定為所有人。
3. 將旅遊版部署網址設定到 [travel-app-config.js](./travel-app-config.js)，不要覆蓋原系統的 `master` 或 `dev` 設定。
4. Cloudflare 靜態檔案需包含：
   - `index.html`
   - `travel-app.js`
   - `travel-styles.css`
   - `travel-app-config.js`
   - `manifest.webmanifest`
   - 完整 `icons/` 資料夾

第一次建立旅程時會自動建立 Google Sheet，並寫入指令碼屬性 `SPREADSHEET_ID`。第一次上傳圖片時會建立 Drive 資料夾，並寫入 `IMAGE_FOLDER_ID`。

## 多幣別規則

一筆「魚板」可以同時記錄 `KRW 3000` 與 `TWD 70`，但必須指定一個結算幣別：

- 選 TWD：只使用 TWD 70 進入台幣結算。
- 選 KRW：只使用 KRW 3000 進入韓幣結算。
- 只有一種金額時，結算幣別就選該幣別。

系統不會自行猜測即時匯率，避免匯率時間點與刷卡手續費造成帳務爭議。

## 儲存體感與重複資料防護

Apps Script 第一次喚醒或 Google Drive 圖片上傳仍可能需要數秒，但慾望、行程、記帳與日期新增都會先更新畫面，再於背景同步。每筆新資料由前端先產生固定 ID，重試時會更新同一筆資料，不會因慢速回應另外新增空白卡片；同步失敗時則還原原本畫面並顯示錯誤。

旅程頁載入時會先顯示瀏覽器快取，再強制向 Sheet 重新讀取一次最新資料。因此管理者直接在 `trips` 工作表修改 `rouletteEnabled` 為 `TRUE`，背景更新完成後也會顯示轉盤按鈕，不會再被 Apps Script 的舊快取遮蔽。

慾望、行程與記帳卡片都採整張卡片點擊；編輯與刪除集中放在詳情視窗內。彈窗使用獨立的內部捲動區，標題與底部操作按鈕不會跟著內容捲出卡片。
