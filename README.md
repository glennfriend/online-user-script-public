# online-user-script-public

個人公開的 [Tampermonkey](https://www.tampermonkey.net/) User Script 集合。
這裡的每一個 `*.user.js` 都可以直接在 Tampermonkey 安裝與使用，未來新增的腳本也會陸續加入此清單。

> 詳細功能與實作說明，請直接點進各個 `.user.js` 檔案的開頭註解與程式碼閱讀。
> 開發規範與設計原則見 [CONVENTIONS.md](CONVENTIONS.md)。

---

## 📦 功能清單

| 腳本 | 說明 | 安裝 |
|------|------|------|
| **YouTube 字幕自動轉繁體** | YouTube 字幕是簡體時，自動切換或翻譯成繁體中文。 | [link](https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-subtitle-to-traditional.user.js) |
| **YouTube 頁面助手** | YouTube 浮動助手，可依時間列出影片並自動分類，Shorts 一鍵轉一般影片頁。 | [link](https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-video-list.user.js) |
| **表單記憶助手** | 任何有表單的頁面：`F1` 儲存所有欄位值，`F2` 叫出清單、勾選後回寫。設定依網址記憶。 | [link](https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/form-memory.user.js) |

---

## 🚀 如何安裝（第一次使用請照這裡做）

### 步驟 1：先安裝 Tampermonkey 擴充功能

如果你的瀏覽器還沒有 Tampermonkey，先去官方頁面安裝：👉 <https://www.tampermonkey.net/>

- **Chrome 使用者請注意**：Chrome 新版需要額外打開一個開關才能執行腳本。
  在網址列輸入 `chrome://extensions` → 找到 Tampermonkey → 點「詳細資料」→ 把 **「允許使用者指令碼 / Allow User Scripts」** 打開。
  （沒打開的話腳本裝了也不會生效。）

### 步驟 2：點「link」安裝腳本

1. 在上面的**功能清單**表格，點你要的腳本那一列的 **`link`**。
2. Tampermonkey 會自動跳出一個「使用者腳本安裝」的畫面。
3. 按綠色的 **安裝 / Install** 按鈕，完成！
4. 打開對應網站（例如 YouTube），腳本就會自動生效。

### ❓ 出現「無效的使用者腳本」？

- 最常見的原因是把 `link` **用拖曳的方式拖進 Tampermonkey**——這樣不會成功。
  正確做法是**直接用滑鼠左鍵點一下 `link`**，讓瀏覽器開啟該網址，Tampermonkey 就會自動跳出安裝畫面。
- 如果點了之後瀏覽器只是把程式碼「顯示成文字」、沒有跳出安裝視窗：
  1. 複製該 `link` 的完整網址。
  2. 打開 Tampermonkey → 進到它的管理面板（左上角圖示 →「管理面板 / Dashboard」）。
  3. 到 **「工具 / Utilities」** 分頁，找到 **「Import from URL / 從網址匯入」**，貼上網址後按匯入即可。

---

## 🔄 更新

安裝後不用手動更新——每個腳本都有版本號（`@version`），Tampermonkey 會定期自動檢查並更新到最新版。
