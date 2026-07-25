// ==UserScript==
// @name         Facebook 訪客解鎖
// @name:en      Facebook Guest View (remove login wall)
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      2.2.0
// @description  未登入瀏覽 Facebook 公開貼文時，用原生關閉鈕關掉一直跳出的登入彈窗，並隱藏上方登入列與下方「登入或註冊」橫幅，讓訪客能順暢看內容。全程不移除任何 DOM 節點。已登入者完全不受影響。
// @author       Glenn
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/facebook-guest-view.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/facebook-guest-view.user.js
// @match        *://*.facebook.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * Facebook 訪客解鎖 — 使用說明
 * ============================================================================
 * 用途：未登入時瀏覽 Facebook 公開貼文，Facebook 會用登入牆擋內容。此腳本自動
 *       排除擋路的元素，讓訪客能正常閱讀。裝好即自動運作，無需操作。
 *
 * 做的事（都只在「未登入」時）：
 *   1. 登入彈窗：分層處理，一發現就依序升級，全程 ≤ 約 0.5 秒。
 *      (1) t=0   按它自己的「關閉」鈕 →（最乾淨）FB 會自行清掉遮罩、解除捲動鎖。
 *      (2) t=150 還在 → 送 Escape，仍是原生關閉途徑。
 *      (3) t=300 還在（FB 某些頁面的登入牆根本沒有 X、關不掉）→ 降級：隱藏
 *          彈窗所在的整個 portal 外層、解除捲動鎖，讓你至少能捲回去看已載入
 *          的內容。降級一律用「改樣式」而非移除節點。
 *   2. 上方登入列 [role="banner"]：用 CSS 隱藏。
 *   3. 下方「登入或註冊 Facebook…」橫幅：設 display:none 隱藏。
 *   4. 只有在頁面真的被鎖住捲動時，才解除 html/body 的捲動鎖。
 *
 * ★ 核心設計原則：全程不移除任何 DOM 節點，也不碰 Facebook 的 React 根容器。
 *   原因（實測得到的教訓）：
 *   - Facebook 是 React 應用，把它管理的節點直接 remove() 會讓 React 之後更新
 *     時拋錯，整個 app 停止渲染 → 頁面變空白或永遠停在骨架畫面。
 *   - 更關鍵的是：用「原生關閉鈕」關掉登入彈窗後，Facebook 會自己清掉背後的
 *     半透明遮罩、也自己解除捲動鎖定。先前版本看到的灰幕與「隱形攔截層」，
 *     其實是硬拔彈窗節點後留下的殘骸——用正常方式關閉就不會產生。
 *   因此這裡一律採用「原生互動 + CSS 隱藏」，不做任何破壞性 DOM 操作。
 *
 * 安全設計：
 *   - 只在「未登入」時作用：靠 c_user cookie 判斷，已登入者一律略過。
 *   - 只關「像登入框」的對話框（含密碼欄或「建立新帳號 / 忘記密碼」字樣），
 *     不會誤關其他對話框（例如相片檢視）。
 *
 * 已知限制（Facebook 伺服器端行為，腳本無法突破）：
 *   - 貼文下方會出現一直載不完的骨架卡片、「查看更多留言」點了沒反應：這是
 *     Facebook 不對未登入者提供更多內容，未安裝本腳本時也一樣。
 *
 * 外部相依（Facebook 改版可能需調整）：
 *   - 彈窗＝[role="dialog"]，關閉鈕＝aria-label 為「關閉」/「Close」；
 *     上方列＝[role="banner"]；下方橫幅＝含「即可和親朋好友 / 登入或註冊」文字
 *     的 position:fixed 容器；登入狀態＝document.cookie 內的 c_user。
 * ============================================================================
 */

(function () {
    'use strict';

    const LOG = '[FB訪客解鎖]';
    const BOTTOM_KW = /即可和親朋好友|登入或註冊|登入或注冊|Log in or sign up/;
    const DIALOG_LOGIN_KW = /建立新帳號|忘記密碼|Create new account|Sign up/i;
    const CLOSE_SELECTOR = '[aria-label="關閉"],[aria-label="Close"],[aria-label="关闭"]';

    // ── 判斷是否已登入（已登入 → 整個腳本不作用）────────────────────────
    const isLoggedIn = () => /(^|;\s*)c_user=/.test(document.cookie);

    // ── 模組：用 CSS 隱藏上方登入列（不動 DOM 結構）──────────────────────
    // 以 <style> 注入，React 完全不會察覺，也不可能因此崩潰。
    function injectHidingCSS() {
        if (document.getElementById('fbguest-style')) return;
        const style = document.createElement('style');
        style.id = 'fbguest-style';
        style.textContent = '[role="banner"]{display:none !important}';
        (document.head || document.documentElement).appendChild(style);
    }

    const SEEN_MARK = 'data-fbguest-seen';     // 已排定處理，避免重複排程
    const HIDDEN_MARK = 'data-fbguest-hidden'; // 已降級強制隱藏

    // ── 模組：關閉登入彈窗（分層策略，時間驅動，全程不移除節點）─────────────
    // 一發現彈窗就立刻依序升級，總耗時 ≤ 約 0.3 秒：
    //   t=0    第 1 層：按彈窗自己的關閉鈕 → 最乾淨，FB 會自行清遮罩與捲動鎖。
    //   t=150  第 2 層：還在 → 送 Escape，仍屬原生關閉途徑。
    //   t=300  第 3 層：還在 → 降級強制隱藏（FB 某些頁面的登入牆沒有 X、關不掉）。
    function closeLoginDialogs() {
        document.querySelectorAll('[role="dialog"]').forEach((d) => {
            const looksLikeLogin = d.querySelector('input[type="password"]') ||
                DIALOG_LOGIN_KW.test(d.textContent || '');
            if (!looksLikeLogin) return;              // 其他對話框不碰
            if (d.getAttribute(SEEN_MARK)) return;    // 已排定升級流程
            d.setAttribute(SEEN_MARK, '1');

            const stillUp = () => d.isConnected && getComputedStyle(d).display !== 'none';

            const btn = d.querySelector(CLOSE_SELECTOR);
            if (btn) btn.click();                     // 第 1 層：立即原生關閉

            setTimeout(() => {                        // 第 2 層
                if (!stillUp()) return;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }, 100);

            setTimeout(() => {                        // 第 3 層
                if (!stillUp()) return;
                forceDismiss(d);
            }, 200);
        });
    }

    // ── 降級處理：隱藏彈窗所在的整個 portal 外層（不移除任何節點）────────────
    // 關鍵：彈窗外面疊著多層「滿螢幕且 pointer-events:auto」的 portal 容器。
    // 只隱藏彈窗本身不夠 —— 那些外層仍蓋滿畫面接收滑鼠與滾輪，而它們自己不是
    // 捲動容器，於是滾輪無處可捲 → 畫面看得到卻捲不動。因此往上找到「除了這個
    // 彈窗以外不含任何其他文字」的最外層容器，整層 display:none。
    // 安全性：以「textContent 等於彈窗文字」為界，一旦某層含有其他內容就停止
    // 往上，所以永遠不會蓋掉頁面內容。
    function outermostDialogWrapper(dialog) {
        const dialogText = (dialog.textContent || '').trim();
        let best = dialog, el = dialog;
        while (el.parentElement && el.parentElement !== document.body) {
            el = el.parentElement;
            if ((el.textContent || '').trim() !== dialogText) break; // 含其他內容 → 停
            best = el;
        }
        return best;
    }

    function forceDismiss(dialog) {
        const wrapper = outermostDialogWrapper(dialog);
        wrapper.style.setProperty('display', 'none', 'important');
        wrapper.setAttribute(HIDDEN_MARK, '1');
        dialog.setAttribute(HIDDEN_MARK, '1');
        console.log(LOG, '此彈窗無法用原生方式關閉，已隱藏其 portal 外層並解除捲動鎖');
        neutralizeLeftoverOverlays();  // 高成本，只在此處跑一次
        deepUnlockScroll();            // 同上
    }

    // ── 模組：讓殘留的全螢幕遮罩失效（只改樣式，永不移除節點）──────────────
    // 僅在降級情境下需要。安全限制：頁面已渲染、不碰 React 根容器、只處理
    // 「沒有文字也沒有媒體」的空層 —— 真正的內容容器不會被影響。
    function neutralizeLeftoverOverlays() {
        if (!document.body) return;
        if ((document.body.innerText || '').trim().length < 200) return;
        const W = innerWidth, H = innerHeight;
        document.querySelectorAll('body *').forEach((e) => {
            const cs = getComputedStyle(e);
            const r = e.getBoundingClientRect();
            if (r.width < W * 0.9 || r.height < H * 0.9) return;
            if ((e.textContent || '').trim().length > 0) return;
            if (e.querySelector('a,img,video,input,button')) return;
            if (e.id && /^mount_/.test(e.id)) return;
            if (cs.pointerEvents !== 'none') e.style.setProperty('pointer-events', 'none', 'important');
            const m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
            const parts = m ? m[1].split(',').map((s) => s.trim()) : [];
            const alpha = parts.length === 4 ? parseFloat(parts[3]) : (parts.length === 3 ? 1 : 0);
            if (alpha > 0) e.style.setProperty('background-color', 'transparent', 'important');
            if (cs.backdropFilter && cs.backdropFilter !== 'none') {
                e.style.setProperty('backdrop-filter', 'none', 'important');
                e.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            }
        });
    }

    // ── 模組：隱藏下方「登入或註冊」橫幅（設樣式，不移除節點）─────────────
    let hiddenBanner = null;   // 快取：已隱藏過就不再重掃（TreeWalker 成本不低）
    let lastBannerScan = 0;
    function hideBottomBanner() {
        if (!document.body) return;
        if (hiddenBanner && hiddenBanner.isConnected && hiddenBanner.style.display === 'none') return;
        // 還沒找到時也不能每輪都掃全文，最多每 500ms 掃一次，避免拖慢主執行緒
        const now = Date.now();
        if (now - lastBannerScan < 500) return;
        lastBannerScan = now;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => BOTTOM_KW.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        });
        const node = walker.nextNode();
        if (!node) return;
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (getComputedStyle(el).position === 'fixed') {
                el.style.setProperty('display', 'none', 'important');
                hiddenBanner = el;
                return;
            }
            el = el.parentElement;
        }
    }

    // ── 模組：解除捲動鎖定（僅在真的被鎖時才動 html/body）─────────────────
    // html/body 在 React 根容器之外，調整它們不影響 React。
    // 常態使用：只檢查 html/body，成本極低，可以每輪跑。
    function unlockScroll() {
        [document.documentElement, document.body].forEach((el) => {
            if (!el) return;
            const cs = getComputedStyle(el);
            if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
                el.style.setProperty('overflow', 'auto', 'important');
            }
            if (el === document.body && cs.position === 'fixed') {
                el.style.setProperty('position', 'static', 'important');
                el.style.removeProperty('top');
            }
        });
    }

    // 只在降級時呼叫一次：彈窗有時把「裝著內容的大容器」鎖成 overflow:hidden。
    // 會逐一取 computed style，成本高，因此絕不放進常態迴圈。
    function deepUnlockScroll() {
        document.querySelectorAll('body *').forEach((e) => {
            const r = e.getBoundingClientRect();
            if (r.height < innerHeight * 0.8) return;
            const cs = getComputedStyle(e);
            if (cs.overflowY !== 'hidden') return;
            if ((e.textContent || '').trim().length < 200) return;
            e.style.setProperty('overflow-y', 'auto', 'important');
        });
    }

    // ── 主流程：清一輪（各模組獨立 try，一個壞不影響其他）─────────────────
    function cleanup() {
        if (isLoggedIn()) return; // 已登入者不動任何東西
        try { closeLoginDialogs(); } catch (e) { console.warn(LOG, 'dialog', e); }
        try { hideBottomBanner(); } catch (e) { console.warn(LOG, 'bottom', e); }
        try { unlockScroll(); } catch (e) { console.warn(LOG, 'scroll', e); }
    }

    // ── 監看 DOM：Facebook 會重複插入登入彈窗與橫幅 ───────────────────────
    // debounce 壓到 50ms，讓「發現彈窗」到「開始處理」幾乎無延遲；
    // 搭配上面的時間驅動升級（150ms / 300ms），整體反應在 0.5 秒內完成。
    let timer = null;
    const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; cleanup(); }, 50); };

    injectHidingCSS();
    new MutationObserver(() => {
        injectHidingCSS();
        // 彈窗要「看到就處理」，不進 debounce：這個查詢很便宜（只掃 role=dialog），
        // 因此偵測延遲趨近於 0，配合 100ms/200ms 升級可在 0.5 秒內完成。
        if (!isLoggedIn() && document.querySelector('[role="dialog"]:not([' + SEEN_MARK + '])')) {
            try { closeLoginDialogs(); } catch (e) { console.warn(LOG, 'dialog', e); }
        }
        schedule();  // 其餘較重的工作維持 debounce
    }).observe(document.documentElement, { childList: true, subtree: true });

    cleanup();
    document.addEventListener('DOMContentLoaded', cleanup);
    window.addEventListener('load', cleanup);
    // 保險：MutationObserver 偶爾會漏（例如彈窗只改樣式而非新增節點），
    // 前 15 秒每 100ms 主動巡一次，之後交給 observer。
    let ticks = 0;
    const iv = setInterval(() => { cleanup(); if (++ticks > 150) clearInterval(iv); }, 100);

    console.log(LOG, '已啟用（僅未登入時作用，不移除任何節點）');
})();
