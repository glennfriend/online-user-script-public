// ==UserScript==
// @name         Facebook 訪客解鎖
// @name:en      Facebook Guest View (remove login wall)
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      1.0.4
// @description  未登入瀏覽 Facebook 公開貼文時，自動關掉一直跳出的登入彈窗，並移除上方登入列與下方「登入或註冊」橫幅，讓訪客能順暢看內容。已登入者完全不受影響。
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
 *       清掉這些擋路的元素，讓訪客能正常閱讀。裝好即自動運作，無需操作。
 *
 * 會清除的三個東西（都只在「未登入」時）：
 *   1. 登入彈窗 [role="dialog"]（會一直跳出來，故持續監看、出現就移除）。
 *   2. 登入牆殘留的全螢幕擋路層：半透明遮罩（畫面變灰）與隱形的
 *      pointer-events:auto 空層（畫面正常卻點不動、捲不動）。
 *      這類層「不移除節點」，只改樣式解除干擾（見下方 neutralize 說明），
 *      以免誤刪 Facebook 的 React 根容器造成整頁空白。
 *   3. 上方登入列 [role="banner"]。
 *   4. 下方「登入或註冊 Facebook…」橫幅（position:fixed 貼底的那條）。
 *   並解除 Facebook 對頁面捲動的鎖定。
 *
 * 安全設計：
 *   - 只在「未登入」時作用：靠 c_user cookie 判斷，已登入者一律略過，不會誤刪
 *     你的導覽列或任何 UI。
 *   - 彈窗只移除「像登入框」的（含密碼欄或「建立新帳號 / 忘記密碼」字樣），
 *     不亂動其他對話框（如相片檢視）。
 *   - 靠 MutationObserver 監看 DOM，Facebook 重新插入時會再次清除。
 *
 * 外部相依（若 Facebook 改版可能需調整）：
 *   - 上方列＝[role="banner"]；下方橫幅＝含「即可和親朋好友 / 登入或註冊」文字
 *     且 position:fixed 的容器；登入狀態＝document.cookie 內的 c_user。
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 設定 ──────────────────────────────────────────────────────────────
    const LOG = '[FB訪客解鎖]';
    const BOTTOM_KW = /即可和親朋好友|登入或註冊|登入或注冊|Log in or sign up/;
    const DIALOG_LOGIN_KW = /建立新帳號|忘記密碼|Create new account|Log in|Sign up/i;

    // ── 判斷是否已登入（已登入 → 整個腳本不作用）────────────────────────
    const isLoggedIn = () => /(^|;\s*)c_user=/.test(document.cookie);

    // ── 模組：解除捲動鎖定（保守：只在真的被鎖時才動，避免弄壞版面）──────
    function unlockScroll() {
        [document.documentElement, document.body].forEach((el) => {
            if (!el) return;
            const cs = getComputedStyle(el);
            // FB 鎖捲動常見手法：overflow:hidden 或把 body 變 position:fixed
            if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
                el.style.setProperty('overflow', 'auto', 'important');
            }
            if (el === document.body && cs.position === 'fixed') {
                el.style.setProperty('position', 'static', 'important');
                el.style.removeProperty('top');
            }
        });
    }

    // ── 模組：移除上方登入列 ──────────────────────────────────────────────
    function removeTopBar() {
        document.querySelectorAll('[role="banner"]').forEach((n) => n.remove());
    }

    // ── 模組：移除登入彈窗（只針對像登入框的對話框）──────────────────────
    function removeLoginDialogs() {
        document.querySelectorAll('[role="dialog"]').forEach((d) => {
            const looksLikeLogin = d.querySelector('input[type="password"]') ||
                DIALOG_LOGIN_KW.test(d.textContent || '');
            if (looksLikeLogin) d.remove();
        });
    }

    // ── 模組：移除下方「登入或註冊」橫幅 ──────────────────────────────────
    // 以文字定位，再往上找到 position:fixed 的容器整條移除。
    // 安全限制：若該容器高度超過視窗一半（表示爬過頭、可能是內容容器）就不刪，
    // 只隱藏文字所在的那一小塊，避免誤刪頁面內容。
    function removeBottomBanner() {
        if (!document.body) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => BOTTOM_KW.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        });
        const node = walker.nextNode();
        if (!node) return;
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (getComputedStyle(el).position === 'fixed') {
                if (el.getBoundingClientRect().height < innerHeight * 0.5) el.remove();
                else el.style.setProperty('display', 'none', 'important');
                return;
            }
            el = el.parentElement;
        }
    }

    // ── 模組：解除全螢幕擋路層的干擾（永不移除節點）────────────────────────
    // 登入牆會留下兩種滿螢幕的擋路層：
    //   (1) 半透明遮罩 → 畫面變灰；(2) 隱形的 pointer-events:auto 空層 →
    //   畫面正常卻吃掉所有點擊與滾輪（點不動、捲不動）。
    //
    // 這裡刻意「不移除節點」，只做兩件無破壞性的事：讓它不吃事件、把遮罩背景
    // 改透明。原因：Facebook 的 React 根容器（#mount_…）在頁面剛載入、內容還
    // 沒渲染時，本身就是「滿螢幕且完全空白」的，任何以「空層」為條件的刪除規則
    // 都會誤刪它，導致整頁永久空白。改成只調整樣式，即使判斷失準也不會弄壞頁面。
    const MARK = 'data-fbguest-neutralized';

    function neutralizeBlockingOverlays() {
        if (!document.body) return;
        // 內容還沒渲染出來前一律不動作（此時無法區分「空的根容器」與「空的遮罩」）
        if ((document.body.innerText || '').trim().length < 200) return;

        // 先還原：先前被判定為擋路層、但現在已長出真實內容的元素（避免誤傷）
        document.querySelectorAll('[' + MARK + ']').forEach((e) => {
            if ((e.textContent || '').trim().length > 0 || e.querySelector('a,img,video,input,button')) {
                e.style.removeProperty('pointer-events');
                e.removeAttribute(MARK);
            }
        });

        const W = innerWidth, H = innerHeight;
        document.querySelectorAll('body *').forEach((e) => {
            const cs = getComputedStyle(e);
            const r = e.getBoundingClientRect();
            if (r.width < W * 0.9 || r.height < H * 0.9) return;      // 需近全螢幕
            if ((e.textContent || '').trim().length > 0) return;      // 有文字 → 是內容容器
            if (e.querySelector('a,img,video,input,button')) return;  // 有媒體/互動 → 是內容
            if (e.id && /^mount_/.test(e.id)) return;                 // 永不碰 React 根容器

            // 隱形攔截層：不吃事件即可，讓點擊/滾輪穿透到底下的內容
            if (cs.pointerEvents !== 'none') {
                e.style.setProperty('pointer-events', 'none', 'important');
                e.setAttribute(MARK, '1'); // 做記號，日後若長出內容可還原
            }
            // 半透明遮罩：把灰幕效果去掉（不移除節點）
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

    // ── 主流程：清一輪 ────────────────────────────────────────────────────
    function cleanup() {
        if (isLoggedIn()) return; // 已登入者不動任何東西
        try { removeLoginDialogs(); } catch (e) { console.warn(LOG, 'dialog', e); }
        try { neutralizeBlockingOverlays(); } catch (e) { console.warn(LOG, 'overlay', e); }
        try { removeTopBar(); } catch (e) { console.warn(LOG, 'topbar', e); }
        try { removeBottomBanner(); } catch (e) { console.warn(LOG, 'bottom', e); }
        try { unlockScroll(); } catch (e) { console.warn(LOG, 'scroll', e); }
    }

    // ── 監看 DOM：Facebook 會重複插入這些元素（尤其登入彈窗）──────────────
    let timer = null;
    const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; cleanup(); }, 200); };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 初次載入 + 前幾秒重試（內容牆常在載入後才出現）
    cleanup();
    document.addEventListener('DOMContentLoaded', cleanup);
    window.addEventListener('load', cleanup);
    let n = 0;
    const iv = setInterval(() => { cleanup(); if (++n > 20) clearInterval(iv); }, 300); // 約 6 秒

    console.log(LOG, '已啟用（僅未登入時作用）');
})();
