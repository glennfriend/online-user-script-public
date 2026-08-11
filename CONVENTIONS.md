# 開發規範 CONVENTIONS

本專案（`online-user-script-public`）所有 User Script 都應遵守以下規範。
新增或修改腳本前，請先讀過本文件。

---

## 〇、文件放置原則

- **腳本專屬的資訊，寫在該腳本自己的 `.user.js` 裡**（放在 metadata 下方的檔頭註解）：
  用途、操作方式、行為細節、儲存 key、已知限制等，都跟著程式碼走。
- **外部 `.md` 只放「共用」的東西**：
  - `README.md`：所有腳本的索引清單（一句話簡介 + 安裝連結）。
  - `CONVENTIONS.md`（本檔）：跨腳本共用的規範與原則。
- 判斷準則：這段資訊只跟「某一支腳本」有關 → 寫進那支 `.user.js`；
  跟「整個專案 / 多支腳本」有關 → 才寫進外部 `.md`。

---

## 〇之二、同類功能合成一支腳本（adapter 模式）

同一種功能要套用到多個網站時，**不要每個網站各做一支腳本**（使用者要裝一堆、還可能互相
打架），而是做成「**共用核心 + 每站一個 adapter**」的單一腳本：

- **核心**只放流程（監看 DOM、分層處理、錯誤隔離、注入 CSS…），不含任何站台細節。
- **adapter** 只描述「這個站台長什麼樣」（selector、cookie 名稱、專屬步驟），不含流程。
- 每次載入**只挑出 hostname 相符的那一個 adapter** 執行，其他完全不觸碰 → 不會打架。
- 每個步驟各自 `try/catch`，某站台 adapter 壞掉只有該站失效，不影響核心與其他站台。
- 新增站台 = 加一個 adapter 物件 + 在 metadata 補 `@match`，不需要動核心。

範例：[guest-view.user.js](guest-view.user.js)（訪客解鎖，支援 Facebook / bilibili）。

---

## 一、設計原則

> 核心：**多花一點把結構做對**，寧可慢一點，也不要留下難維護的爛結構。

1. **結構化、清楚的邊界、容易修改、可插拔的獨立模組**
   - 每個功能都是一個界線清楚的模組，對外只暴露必要的介面。
   - 模組之間用明確的輸入／輸出溝通，不共用隱藏狀態。
   - 要能單獨抽換或移除某個模組，而不影響其他部分。

2. **多花一點把結構做對**
   - 寧願前期多花時間設計，也不要為了快而破壞結構。
   - 重複出現的邏輯要抽成共用函式／模組，不要複製貼上。

3. **誠實顯示錯誤與外部相依**
   - 錯誤要明確顯示（console 或 UI 提示），**不要靜默吞掉**。
   - 對外部相依（DOM 結構、第三方 API、瀏覽器擴充功能等）要清楚標示；相依不存在時要明確報錯，而不是假裝成功。

4. **功能寫壞時只錯單一模組**
   - 一個模組出錯，不可以拖垮整個腳本或其他功能。
   - 各模組以 try/catch 或防禦性檢查隔離，確保故障範圍最小。

5. **絕不 workaround**
   - 不用暫時性、掩蓋問題的 hack。
   - 遇到問題找出根因並正確修正；若暫時無法解決，明確標註 `TODO` 與原因，不假裝已修好。

---

## 二、自動更新機制

讓使用者裝一次之後就能自動收到新版，每支腳本都必須具備以下條件。

### 每支 `*.user.js` 的 metadata 一定要有

```js
// @version      x.y.z
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/<檔名>.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/<檔名>.user.js
```

- `@updateURL` / `@downloadURL` 一律指向 `main` 分支上的 raw 網址。
- Tampermonkey 會定期（預設約每天一次）向 `@updateURL` 檢查版本。

### 改版流程（每次修改腳本都要做）

1. 修改程式碼。
2. **把 `@version` 往上加**（例如 `1.0.0` → `1.0.1`）。
   > ⚠️ 版本號沒變，Tampermonkey 就不會更新。這是最容易漏掉、也最關鍵的一步。
3. 若腳本內有寫死的版本字串（例如 `console.log('[xxx v1.0.0]')`），一併更新。
4. commit + push 到 `main`。

### 注意事項

- `raw.githubusercontent.com` 有 CDN 快取（約 5 分鐘），瀏覽器直接開網址可能看到舊版；這**不影響** Tampermonkey 更新（它會避開快取）。想強制看最新可在網址後加 `?v=時間戳`，或在瀏覽器按 `Ctrl`+`F5`。
- 要立即驗證更新：Tampermonkey 管理面板 → 已安裝的使用者腳本 → 「檢查使用者腳本更新」。

---

## 三、新增腳本檢查清單

- [ ] 檔名用 kebab-case，結尾 `.user.js`（例如 `form-memory.user.js`）。
- [ ] metadata 具備 `@name`、`@version`、`@description`、`@match`、`@updateURL`、`@downloadURL`。
- [ ] 腳本檔頭有「自我說明」註解（用途 / 操作 / 行為細節 / 限制）——專屬資訊寫在自己的 `.user.js`，別放外部 `.md`（見「〇、文件放置原則」）。
- [ ] 需要跨頁保存資料時使用 `GM_setValue` / `GM_getValue`，並在 metadata `@grant`。
- [ ] 熱鍵不與同頁其他腳本衝突（必要時用 `@exclude` 排除特定站點）。
- [ ] 符合上方「設計原則」：模組化、錯誤誠實、故障隔離、不 workaround。
- [ ] 在 `README.md` 的功能清單表格新增一列（含 `link` 安裝連結）。
- [ ] push 前實測過主要流程，確認可運作、無明顯 bug。
