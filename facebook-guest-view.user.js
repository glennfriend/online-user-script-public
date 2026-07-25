// ==UserScript==
// @name         Facebook 訪客解鎖
// @name:en      Facebook Guest View (remove login wall)
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      2.0.0
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
 *   1. 登入彈窗：按它自己的「關閉」鈕（找不到則送 Escape）關掉，會一直跳出所以
 *      持續監看。
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

    // ── 模組：關閉登入彈窗（用它自己的關閉鈕，不移除節點）──────────────────
    function closeLoginDialogs() {
        document.querySelectorAll('[role="dialog"]').forEach((d) => {
            const looksLikeLogin = d.querySelector('input[type="password"]') ||
                DIALOG_LOGIN_KW.test(d.textContent || '');
            if (!looksLikeLogin) return;                 // 其他對話框不碰

            const btn = d.querySelector(CLOSE_SELECTOR);
            if (btn) {
                btn.click();                             // 原生關閉：FB 會自行清理遮罩與捲動鎖
                return;
            }
            // 找不到關閉鈕時的備援：送 Escape，同樣是原生關閉途徑
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        });
    }

    // ── 模組：隱藏下方「登入或註冊」橫幅（設樣式，不移除節點）─────────────
    function hideBottomBanner() {
        if (!document.body) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => BOTTOM_KW.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        });
        const node = walker.nextNode();
        if (!node) return;
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (getComputedStyle(el).position === 'fixed') {
                el.style.setProperty('display', 'none', 'important');
                return;
            }
            el = el.parentElement;
        }
    }

    // ── 模組：解除捲動鎖定（僅在真的被鎖時才動 html/body）─────────────────
    // html/body 在 React 根容器之外，調整它們不影響 React。
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

    // ── 主流程：清一輪（各模組獨立 try，一個壞不影響其他）─────────────────
    function cleanup() {
        if (isLoggedIn()) return; // 已登入者不動任何東西
        try { closeLoginDialogs(); } catch (e) { console.warn(LOG, 'dialog', e); }
        try { hideBottomBanner(); } catch (e) { console.warn(LOG, 'bottom', e); }
        try { unlockScroll(); } catch (e) { console.warn(LOG, 'scroll', e); }
    }

    // ── 監看 DOM：Facebook 會重複插入登入彈窗與橫幅 ───────────────────────
    let timer = null;
    const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; cleanup(); }, 200); };

    injectHidingCSS();
    new MutationObserver(() => { injectHidingCSS(); schedule(); })
        .observe(document.documentElement, { childList: true, subtree: true });

    cleanup();
    document.addEventListener('DOMContentLoaded', cleanup);
    window.addEventListener('load', cleanup);

    console.log(LOG, '已啟用（僅未登入時作用，不移除任何節點）');
})();
