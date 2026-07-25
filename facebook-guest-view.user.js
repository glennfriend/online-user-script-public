// ==UserScript==
// @name         Facebook 訪客解鎖
// @name:en      Facebook Guest View (remove login wall)
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      1.0.1
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
 *   2. 彈窗背後的半透明遮罩（會讓畫面變灰、又擋住捲動的那層空 div）。
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

    // ── 模組：解除捲動鎖定 ────────────────────────────────────────────────
    function unlockScroll() {
        [document.documentElement, document.body].forEach((el) => {
            if (!el) return;
            el.style.setProperty('overflow', 'auto', 'important');
            el.style.setProperty('position', 'static', 'important');
            el.style.setProperty('height', 'auto', 'important');
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
    function removeBottomBanner() {
        if (!document.body) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => BOTTOM_KW.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        });
        const node = walker.nextNode();
        if (!node) return;
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (getComputedStyle(el).position === 'fixed') { el.remove(); return; }
            el = el.parentElement;
        }
    }

    // ── 模組：移除半透明遮罩 ──────────────────────────────────────────────
    // 登入彈窗背後那層會讓畫面變灰、又擋住捲動的遮罩：一個近全螢幕、position
    // fixed/absolute、背景半透明（或有 backdrop-filter）、且「沒有子元素」的空層。
    // 限定「空層 + 半透明」才刪，避免誤刪有內容的容器或不透明的頁面背景。
    function removeDimOverlays() {
        const W = innerWidth, H = innerHeight;
        document.querySelectorAll('body *').forEach((e) => {
            if (e.childElementCount !== 0) return;                 // 有內容的層不碰
            const cs = getComputedStyle(e);
            if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
            const r = e.getBoundingClientRect();
            if (r.width < W * 0.9 || r.height < H * 0.9) return;    // 需近全螢幕
            const m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
            const parts = m ? m[1].split(',').map((s) => s.trim()) : [];
            const alpha = parts.length === 4 ? parseFloat(parts[3]) : (parts.length === 3 ? 1 : 0);
            const translucentDim = alpha > 0 && alpha < 1;
            const blurDim = cs.backdropFilter && cs.backdropFilter !== 'none';
            if (translucentDim || blurDim) e.remove();
        });
    }

    // ── 主流程：清一輪 ────────────────────────────────────────────────────
    function cleanup() {
        if (isLoggedIn()) return; // 已登入者不動任何東西
        try { removeLoginDialogs(); } catch (e) { console.warn(LOG, 'dialog', e); }
        try { removeDimOverlays(); } catch (e) { console.warn(LOG, 'overlay', e); }
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
