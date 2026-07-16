# online-user-script-public

個人公開的 [Tampermonkey](https://www.tampermonkey.net/) User Script 集合。
這裡的每一個 `*.user.js` 都可以直接在 Tampermonkey 安裝與使用，未來新增的腳本也會陸續加入此清單。

> 詳細功能與實作說明，請直接點進各個 `.user.js` 檔案的開頭註解與程式碼閱讀。

---

## 📦 功能清單

| 腳本 | 說明 | 安裝 | 原始碼 |
|------|------|------|--------|
| **YouTube 字幕自動轉繁體** | 看 YouTube 時，若目前字幕是簡體中文：有繁體字幕軌就自動切過去；沒有但可翻譯就自動翻成繁體中文（zh-Hant）。載入後會持續盯場，撐過 YouTube 把字幕重置回簡體的情況。 | [安裝](https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-subtitle-to-traditional.user.js) | [youtube-subtitle-to-traditional.user.js](youtube-subtitle-to-traditional.user.js) |
| **YouTube 頁面助手** | YouTube 浮動助手，依當前頁面顯示不同功能選單：首頁 / 搜尋結果 / 頻道頁 / 訂閱內容 / 播放清單可「列出所有影片並依時間排序」，並自動為影片加上分類標籤（影劇、美食、健康、Game、財經、科技…）；在 Shorts 頁可一鍵轉成一般影片頁、快轉／倒退。預設熱鍵 `F1` 開關面板。 | [安裝](https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-video-list.user.js) | [youtube-video-list.user.js](youtube-video-list.user.js) |

---

## 🚀 如何安裝 / 引用

1. 先在瀏覽器安裝 [Tampermonkey](https://www.tampermonkey.net/) 擴充功能。
2. 點上面表格中的 **「安裝」** 連結（也就是 `raw.githubusercontent.com` 上的 `*.user.js` 網址）。
3. Tampermonkey 會自動辨識為 User Script 並跳出安裝畫面，按 **安裝 / Install** 即可。
4. 之後開啟對應網站（例如 YouTube）腳本就會自動生效。

> 安裝連結的網址格式為：
> `https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/<檔名>.user.js`

---

## 🔄 更新

- 每個腳本都有 `@version`，Tampermonkey 會定期向來源網址檢查是否有新版本。
- 若想讓「自動更新」更可靠，可在腳本 metadata 中加入 `@updateURL` 與 `@downloadURL`（見下方說明）。
