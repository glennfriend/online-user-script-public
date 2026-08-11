// ==UserScript==
// @name         訪客解鎖（多站台）
// @name:en      Guest View (multi-site login-wall remover)
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      1.0.0
// @description  未登入瀏覽時自動排除擋路的登入牆：關掉一直跳出的登入彈窗、隱藏登入橫幅，讓訪客能順暢看內容。目前支援 Facebook、bilibili，新站台只要加一個 adapter。已登入者完全不受影響。
// @author       Glenn
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/guest-view.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/guest-view.user.js
// @match        *://*.facebook.com/*
// @match        *://*.bilibili.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * 訪客解鎖（多站台） — 使用說明
 * ============================================================================
 * 用途：未登入瀏覽網站時，網站常用登入牆擋住內容。此腳本自動把擋路的元素排除，
 *       讓訪客能正常閱讀。裝好即自動運作，無需操作。
 *
 * 目前支援：Facebook、bilibili。
 *
 * ── 架構：共用核心 + 每站一個 adapter ──────────────────────────────────────
 * 這支腳本刻意做成「一支腳本管所有站台」，避免每個站台各裝一支、彼此打架：
 *
 *   核心引擎（下方 CORE 區）  ：所有站台共用的流程 —— 判斷未登入、監看 DOM、
 *                              分層關閉彈窗、注入 CSS、解除捲動鎖、錯誤隔離。
 *   站台 adapter（ADAPTERS）  ：只描述「這個站台長什麼樣」，不含流程邏輯。
 *
 * 不會打架的原因：每次載入只會挑出「hostname 相符」的那一個 adapter 執行，
 * 其他 adapter 完全不會被觸碰；且每個步驟各自 try/catch，某站台的 adapter
 * 寫壞時只有那個站台失效，不影響核心與其他站台。
 *
 * ★ 要新增站台，只要在 ADAPTERS 陣列加一個物件，欄位如下：
 *     id             站台代號（只用於 log）
 *     match(host)    傳回 true 表示這個 adapter 負責目前網域
 *     isLoggedIn()   傳回 true 表示使用者已登入 → 整支腳本略過不動作
 *     dialogSelector 找登入彈窗（或其遮罩根節點）的 CSS selector
 *     isLoginDialog(el)  再確認該元素真的是「登入牆」而非其他對話框
 *     closeSelector  彈窗內「關閉鈕」的 CSS selector
 *     css            （選填）要靜態隱藏的東西，例如登入橫幅
 *     steps          （選填）站台專屬的額外處理函式陣列，各自獨立
 *   別忘了在 metadata 補上該站台的 @match。
 *
 * ★ 關閉彈窗一律走「分層策略」，一發現就依序升級，總耗時 ≤ 約 0.4 秒：
 *     t=0     按彈窗自己的關閉鈕 →（最乾淨）網站會自行清掉遮罩、解除捲動鎖。
 *     t=120ms 還在 → 再按一次（彈窗剛掛上時關閉鈕可能還沒綁好事件）。
 *     t=240ms 還在 → 送 Escape，仍屬原生關閉途徑。
 *     t=380ms 還在（有些頁面的登入牆根本沒有關閉鈕）→ 降級：隱藏彈窗所在的
 *             整個 portal 外層並解除捲動鎖，讓你至少能捲回去看已載入的內容。
 *
 * ★ 核心設計原則：全程不移除任何 DOM 節點（只按鈕、只改樣式）。
 *   原因（實測得到的教訓）：Facebook 這類 React 應用，把它管理的節點直接
 *   remove() 會讓 React 之後更新時拋錯、整個 app 停止渲染 → 頁面變空白或永遠
 *   停在骨架畫面。用原生方式關閉，網站反而會自己把遮罩和捲動鎖清乾淨。
 *
 * 已知限制（網站伺服器端行為，腳本無法突破）：
 *   - Facebook 貼文下方會出現一直載不完的骨架卡片、「查看更多留言」點了沒反應：
 *     這是 Facebook 不對未登入者提供更多內容，未安裝本腳本時也一樣。
 *
 * 外部相依（網站改版時要調整的就是 ADAPTERS 裡的 selector 與 cookie 名稱）。
 * ============================================================================
 */

(function () {
    'use strict';

    const LOG = '[訪客解鎖]';

    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  ADAPTERS — 站台描述（要支援新站台就加一個物件，不必改核心）           ║
    // ╚══════════════════════════════════════════════════════════════════════╝

    // Facebook 專屬：隱藏下方「登入或註冊 Facebook…」橫幅。
    // 這條橫幅沒有穩定的 class 可寫死在 CSS，只能靠文字定位，因此做成站台步驟。
    const FB_BOTTOM_KW = /即可和親朋好友|登入或註冊|登入或注冊|Log in or sign up/;
    let fbHiddenBanner = null, fbLastScan = 0;
    function facebookHideBottomBanner() {
        if (!document.body) return;
        if (fbHiddenBanner && fbHiddenBanner.isConnected && fbHiddenBanner.style.display === 'none') return;
        const now = Date.now();
        if (now - fbLastScan < 500) return;   // TreeWalker 成本不低，最多每 500ms 一次
        fbLastScan = now;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => FB_BOTTOM_KW.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
        });
        const node = walker.nextNode();
        if (!node) return;
        let el = node.parentElement;
        while (el && el !== document.body) {
            if (getComputedStyle(el).position === 'fixed') {
                el.style.setProperty('display', 'none', 'important');
                fbHiddenBanner = el;
                return;
            }
            el = el.parentElement;
        }
    }

    const ADAPTERS = [
        {
            id: 'facebook',
            match: (host) => /(^|\.)facebook\.com$/.test(host),
            isLoggedIn: () => /(^|;\s*)c_user=/.test(document.cookie),
            css: '[role="banner"]{display:none !important}',   // 上方登入列
            dialogSelector: '[role="dialog"]',
            isLoginDialog: (el) => !!el.querySelector('input[type="password"]') ||
                /建立新帳號|忘記密碼|Create new account|Sign up/i.test(el.textContent || ''),
            closeSelector: '[aria-label="關閉"],[aria-label="Close"],[aria-label="关闭"]',
            steps: [facebookHideBottomBanner],
        },
        {
            id: 'bilibili',
            match: (host) => /(^|\.)bilibili\.com$/.test(host),
            isLoggedIn: () => /(^|;\s*)DedeUserID=/.test(document.cookie),
            // .bili-mini-mask 就是遮罩兼彈窗根節點（body 直接子層、fixed、z-index 10010）
            dialogSelector: '.bili-mini-mask',
            isLoginDialog: (el) => !!el.querySelector('.bili-mini-login-right-wp,.login-scan-wp') ||
                /扫码登录|扫描二维码登录|密码登录|短信登录|其他方式登录|未注册过哔哩哔哩/.test(el.textContent || ''),
            closeSelector: '.bili-mini-close-icon',
            steps: [],
        },
    ];

    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  CORE — 所有站台共用的流程（新增站台時不需要改這裡）                   ║
    // ╚══════════════════════════════════════════════════════════════════════╝

    const site = ADAPTERS.find((a) => { try { return a.match(location.hostname); } catch (e) { return false; } });
    if (!site) return;                        // 這個網域沒有對應 adapter → 完全不作用

    const SEEN_MARK = 'data-guestview-seen';
    const HIDDEN_MARK = 'data-guestview-hidden';
    const STYLE_ID = 'guestview-style';

    // 每個步驟都獨立包起來：某個模組壞掉不會拖垮其他模組
    function guard(name, fn) {
        try { fn(); } catch (e) { console.warn(LOG, site.id, name, e); }
    }

    // ── 注入站台的靜態隱藏 CSS（用 <style>，React 不會察覺，也不可能因此崩潰）
    function injectCSS() {
        if (!site.css || document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = site.css;
        (document.head || document.documentElement).appendChild(style);
    }

    // ── 分層關閉登入彈窗 ──────────────────────────────────────────────────
    function dismissLoginDialogs() {
        document.querySelectorAll(site.dialogSelector).forEach((d) => {
            if (!site.isLoginDialog(d)) return;       // 不是登入牆 → 不碰
            if (d.getAttribute(SEEN_MARK)) return;    // 已排定升級流程
            d.setAttribute(SEEN_MARK, '1');

            const stillUp = () => d.isConnected && getComputedStyle(d).display !== 'none';

            const clickClose = () => {
                const btn = d.querySelector(site.closeSelector);
                if (btn) { btn.click(); return true; }
                return false;
            };

            clickClose();                             // 第 1 層：原生關閉鈕（立即）

            setTimeout(() => {                        // 第 1 層重試：彈窗剛掛上時
                if (!stillUp()) return;               // 關閉鈕可能還沒綁好事件，
                clickClose();                         // 或稍後才出現，所以再按一次
            }, 120);

            setTimeout(() => {                        // 第 2 層：Escape
                if (!stillUp()) return;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            }, 240);

            setTimeout(() => {                        // 第 3 層：降級強制隱藏
                if (!stillUp()) return;
                forceDismiss(d);
            }, 380);
        });
    }

    // ── 降級：隱藏彈窗所在的整個 portal 外層（不移除節點）──────────────────
    // 關鍵：彈窗外面常疊著多層「滿螢幕且會吃滑鼠事件」的 portal 容器。只隱藏
    // 彈窗本身不夠 —— 那些外層仍蓋滿畫面接收滾輪，而它們自己不是捲動容器，
    // 於是滾輪無處可捲 → 畫面看得到卻捲不動。因此往上找到「除了這個彈窗以外
    // 不含任何其他文字」的最外層容器，整層隱藏。一遇到含其他內容的層就停止
    // 往上，所以永遠不會蓋掉頁面內容。
    function outermostWrapper(dialog) {
        const dialogText = (dialog.textContent || '').trim();
        let best = dialog, el = dialog;
        while (el.parentElement && el.parentElement !== document.body) {
            el = el.parentElement;
            if ((el.textContent || '').trim() !== dialogText) break;
            best = el;
        }
        return best;
    }

    function forceDismiss(dialog) {
        const wrapper = outermostWrapper(dialog);
        wrapper.style.setProperty('display', 'none', 'important');
        wrapper.setAttribute(HIDDEN_MARK, '1');
        dialog.setAttribute(HIDDEN_MARK, '1');
        console.log(LOG, site.id, '彈窗無法用原生方式關閉，已隱藏其外層並解除捲動鎖');
        guard('neutralize', neutralizeLeftoverOverlays);   // 高成本，只在降級時跑
        guard('deepUnlock', deepUnlockScroll);             // 同上
    }

    // ── 降級用：讓殘留的全螢幕空層失效（只改樣式，永不移除節點）─────────────
    // 安全限制：頁面已渲染、不碰 React 根容器、只處理「沒有文字也沒有媒體」的
    // 空層 —— 真正的內容容器不會被影響。
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

    // ── 解除捲動鎖：常態只看 html/body，成本極低 ──────────────────────────
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

    // 只在降級時呼叫：彈窗有時把「裝著內容的大容器」鎖成 overflow:hidden。
    // 逐一取 computed style 成本高，絕不放進常態迴圈。
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

    // ── 主流程 ────────────────────────────────────────────────────────────
    function cleanup() {
        if (site.isLoggedIn()) return;        // 已登入者不動任何東西
        guard('dialog', dismissLoginDialogs);
        (site.steps || []).forEach((step, i) => guard('step' + i, step));
        guard('scroll', unlockScroll);
    }

    // ── 監看 DOM：登入彈窗會重複跳出 ──────────────────────────────────────
    let timer = null;
    const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = null; cleanup(); }, 50); };

    injectCSS();
    new MutationObserver(() => {
        guard('css', injectCSS);
        // 彈窗要「看到就處理」，不進 debounce：這個查詢很便宜，偵測延遲趨近於 0，
        // 配合 100ms/200ms 升級可在 0.5 秒內完成。
        if (!site.isLoggedIn() && document.querySelector(site.dialogSelector + ':not([' + SEEN_MARK + '])')) {
            guard('dialog', dismissLoginDialogs);
        }
        schedule();                            // 其餘較重的工作維持 debounce
    }).observe(document.documentElement, { childList: true, subtree: true });

    cleanup();
    document.addEventListener('DOMContentLoaded', cleanup);
    window.addEventListener('load', cleanup);
    // 保險：MutationObserver 偶爾會漏（例如彈窗只改樣式而非新增節點），
    // 前 15 秒每 100ms 主動巡一次，之後交給 observer。
    let ticks = 0;
    const iv = setInterval(() => { cleanup(); if (++ticks > 150) clearInterval(iv); }, 100);

    console.log(LOG, '已啟用：' + site.id + '（僅未登入時作用，不移除任何節點）');
})();
