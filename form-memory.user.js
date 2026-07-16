// ==UserScript==
// @name         表單記憶助手
// @name:en      Form Memory
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      1.0.3
// @description  在任何有表單的頁面：F1 儲存目前所有 input / select / checkbox / radio 的值，F2 叫出清單，勾選要套用的項目後回寫。設定值依網址（host + path）分別記憶。
// @author       Glenn
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/form-memory.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/form-memory.user.js
// @match        *://*/*
// @exclude      *://*.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const LOG = '[表單記憶]';
    const log = (...a) => console.log(LOG, ...a);
    log('腳本已載入');

    // ── 儲存抽象層：有 GM_* 就用 GM_*，否則退回 localStorage ──────────────
    const store = {
        get(k, d) {
            try { return (typeof GM_getValue === 'function') ? GM_getValue(k, d) : (localStorage.getItem(k) ?? d); }
            catch (e) { return d; }
        },
        set(k, v) {
            try { if (typeof GM_setValue === 'function') GM_setValue(k, v); else localStorage.setItem(k, v); }
            catch (e) { log('儲存失敗', e); }
        },
    };

    const PREFIX = 'formmem::';
    const pageKey = () => PREFIX + location.host + location.pathname;
    const POS_KEY = PREFIX + '__dialogpos__';   // 記住視窗上次被拖到的位置（跨頁通用）

    // 不處理的 input type（密碼、檔案、隱藏、按鈕類）
    const SKIP_TYPES = ['password', 'file', 'hidden', 'submit', 'reset', 'button', 'image'];

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');

    // ── 收集目前頁面的表單值 ──────────────────────────────────────────────
    function collectFields() {
        const els = document.querySelectorAll('input, select, textarea');
        const entries = [];
        els.forEach((el) => {
            const tag = el.tagName.toLowerCase();
            const type = (el.type || tag).toLowerCase();
            if (tag === 'input' && SKIP_TYPES.includes(type)) return;
            if (el.disabled) return;

            let value, optvalue = '';
            if (type === 'checkbox' || type === 'radio') {
                if (!el.checked) return;            // 只記住有勾選 / 選中的
                value = true;
                optvalue = el.value;
            } else if (tag === 'select' && el.multiple) {
                value = Array.from(el.selectedOptions).map((o) => o.value);
                if (value.length === 0) return;
            } else {
                value = el.value;
                if (value === '' || value == null) return; // 空值不記
            }

            entries.push({
                tag, type,
                id: el.id || '',
                name: el.name || '',
                optvalue,
                selector: cssPath(el),
                value,
                label: fieldLabel(el),
                display: valueDisplay(el, tag, type),
            });
        });
        return entries;
    }

    // ── 依 entry 在目前頁面重新找回元素 ──────────────────────────────────
    function findElement(entry) {
        if (entry.id) {
            const el = document.getElementById(entry.id);
            if (el) return el;
        }
        if (entry.name) {
            if (entry.type === 'radio' || entry.type === 'checkbox') {
                const el = document.querySelector(`input[name="${cssEscape(entry.name)}"][value="${cssEscape(entry.optvalue || '')}"]`);
                if (el) return el;
            } else {
                const el = document.querySelector(`[name="${cssEscape(entry.name)}"]`);
                if (el) return el;
            }
        }
        if (entry.selector) {
            try { const el = document.querySelector(entry.selector); if (el) return el; } catch (e) { /* 選擇器失效 */ }
        }
        return null;
    }

    // ── 把值寫回元素，並觸發事件讓框架（React/Vue…）感知 ─────────────────
    function fire(el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function setNativeValue(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
            : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
                : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    }
    function applyEntry(entry) {
        const el = findElement(entry);
        if (!el) return false;
        const tag = el.tagName.toLowerCase();
        const type = (el.type || tag).toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            if (!el.checked) { el.checked = true; fire(el); }
        } else if (tag === 'select' && el.multiple) {
            const vals = Array.isArray(entry.value) ? entry.value : [entry.value];
            Array.from(el.options).forEach((o) => { o.selected = vals.includes(o.value); });
            fire(el);
        } else {
            setNativeValue(el, entry.value);
            fire(el);
        }
        return true;
    }

    // ── 產生欄位的可讀標籤 ────────────────────────────────────────────────
    function fieldLabel(el) {
        let txt = '';
        if (el.id) {
            const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
            if (l) txt = l.innerText.trim();
        }
        if (!txt) { const wrap = el.closest('label'); if (wrap) txt = wrap.innerText.trim(); }
        if (!txt) txt = el.getAttribute('aria-label') || el.placeholder || el.name || el.id || (el.type || el.tagName.toLowerCase());
        txt = (txt || '').replace(/\s+/g, ' ').trim();
        return txt.length > 60 ? txt.slice(0, 60) + '…' : txt;
    }

    // ── 產生值的顯示字串 ──────────────────────────────────────────────────
    function valueDisplay(el, tag, type) {
        if (type === 'checkbox' || type === 'radio') {
            const v = el.value && el.value !== 'on' ? ` (${el.value})` : '';
            return '✓ 勾選' + v;
        }
        if (tag === 'select') {
            const opts = Array.from(el.selectedOptions).map((o) => o.textContent.trim());
            return opts.join(', ');
        }
        return String(el.value);
    }

    // ── 產生元素的 CSS 路徑（找不回 id/name 時的備援）─────────────────────
    function cssPath(el) {
        if (el.id) return '#' + cssEscape(el.id);
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 6) {
            let sel = node.nodeName.toLowerCase();
            if (node.name) { sel += `[name="${cssEscape(node.name)}"]`; parts.unshift(sel); break; }
            const parent = node.parentNode;
            if (parent && parent.children) {
                const same = Array.from(parent.children).filter((c) => c.nodeName === node.nodeName);
                if (same.length > 1) sel += `:nth-of-type(${same.indexOf(node) + 1})`;
            }
            parts.unshift(sel);
            node = node.parentNode;
        }
        return parts.join(' > ');
    }

    // ── F1：儲存 ──────────────────────────────────────────────────────────
    function save() {
        const entries = collectFields();
        if (!entries.length) { toast('這個頁面沒有可儲存的表單欄位'); return; }
        store.set(pageKey(), JSON.stringify(entries));
        toast(`已儲存 ${entries.length} 個欄位設定`);
        log('已儲存', entries);
    }

    // ── F2：讀取（先跳清單）──────────────────────────────────────────────
    function load() {
        let entries = [];
        try { entries = JSON.parse(store.get(pageKey(), '') || '[]'); } catch (e) { entries = []; }
        if (!entries.length) { toast('這個頁面還沒有已儲存的設定，請先按 F1 儲存'); return; }
        showDialog(entries);
    }

    // ── 讀取用的勾選視窗（Shadow DOM，避免被頁面樣式影響）─────────────────
    let hostEl = null;
    let dragCleanup = null;      // 拖拽用的 window 事件清理函式
    function closeDialog() {
        if (dragCleanup) { dragCleanup(); dragCleanup = null; }
        if (hostEl) { hostEl.remove(); hostEl = null; }
        document.removeEventListener('keydown', onDialogKey, true);
    }
    function onDialogKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeDialog(); }
    }

    // 還原視窗位置；超出視界則不套用（交由 CSS 預設置中）
    function restorePosition(modal) {
        let pos = null;
        try { pos = JSON.parse(store.get(POS_KEY, '') || 'null'); } catch (e) { pos = null; }
        if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
        // 至少讓標題列留在畫面內才還原（水平留 100px、垂直留 40px 可抓）
        const maxLeft = window.innerWidth - 100;
        const maxTop = window.innerHeight - 40;
        if (pos.left < 0 || pos.top < 0 || pos.left > maxLeft || pos.top > maxTop) return; // 超出視界 → 回預設位置
        modal.style.left = pos.left + 'px';
        modal.style.top = pos.top + 'px';
        modal.style.transform = 'none';
    }

    function showDialog(entries) {
        closeDialog();
        // host 覆蓋整頁但不吃滑鼠事件（pointer-events: none），只有 modal 本身可互動；
        // 因此不會蓋住、也不會變暗背景頁面。
        hostEl = document.createElement('div');
        hostEl.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
        const shadow = hostEl.attachShadow({ mode: 'open' });

        const rows = entries.map((e, i) => `
            <label class="row">
                <input type="checkbox" class="chk" data-i="${i}" checked>
                <span class="lbl">${esc(e.label)}</span>
                <span class="val" title="${esc(e.display)}">${esc(e.display)}</span>
            </label>`).join('');

        shadow.innerHTML = `
            <style>
                .modal { pointer-events: auto; position: fixed; top: 15vh; left: 50%; transform: translateX(-50%); width: 480px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); background: rgba(30,30,30,.5); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); color: #e0e0e0; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden; font-family: Arial, "Microsoft JhengHei", sans-serif; }
                .head { padding: 12px 16px; border-bottom: 1px solid #333; cursor: move; user-select: none; }
                .head h2 { margin: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .head .host { color: #999; font-weight: normal; }
                .tools { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #333; font-size: 13px; color: #bbb; }
                .list { overflow-y: auto; padding: 6px 8px; flex: 1; }
                .row { display: flex; align-items: center; gap: 10px; padding: 8px 8px; border-radius: 6px; cursor: pointer; }
                .row:hover { background: #2a2a2a; }
                .row .chk { width: 16px; height: 16px; flex: 0 0 auto; cursor: pointer; }
                .row .lbl { flex: 0 0 40%; font-size: 13px; color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .row .val { flex: 1; font-size: 13px; color: #7fd1ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 16px; border-top: 1px solid #333; }
                button { font-size: 14px; padding: 8px 16px; border-radius: 6px; border: 1px solid #444; background: #2a2a2a; color: #e0e0e0; cursor: pointer; }
                button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
                button:hover { filter: brightness(1.15); }
            </style>
            <div class="modal">
                <div class="head">
                    <h2>表單設定 (${entries.length}) <span class="host">by ${esc(location.host + location.pathname)}</span></h2>
                </div>
                <div class="tools">
                    <input type="checkbox" id="all" checked>
                    <label for="all">全選 / 全不選</label>
                </div>
                <div class="list">${rows}</div>
                <div class="foot">
                    <button class="cancel">取消</button>
                    <button class="primary apply">讀取（套用勾選項目）</button>
                </div>
            </div>`;

        document.documentElement.appendChild(hostEl);

        const $ = (sel) => shadow.querySelector(sel);
        const chks = () => Array.from(shadow.querySelectorAll('.chk'));

        $('.cancel').addEventListener('click', closeDialog);
        $('#all').addEventListener('change', (e) => { chks().forEach((c) => { c.checked = e.target.checked; }); });
        $('.apply').addEventListener('click', () => {
            const selected = chks().filter((c) => c.checked).map((c) => entries[+c.dataset.i]);
            let ok = 0, miss = 0;
            selected.forEach((entry) => { applyEntry(entry) ? ok++ : miss++; });
            closeDialog();
            toast(`已套用 ${ok} 個欄位` + (miss ? `，${miss} 個在頁面上找不到` : ''));
        });

        // ── 拖拽：抓標題列可移動整個視窗（避免擋到視線）────────────────────
        const modal = $('.modal');
        const head = $('.head');

        // 還原上次位置；若位置已超出目前視界（例如換了較小螢幕、或上次拖到邊角外）
        // 就忽略、維持 CSS 預設置中位置。
        restorePosition(modal);

        let drag = null;
        const onMove = (e) => {
            if (!drag) return;
            modal.style.left = (e.clientX - drag.dx) + 'px';
            modal.style.top = (e.clientY - drag.dy) + 'px';
            modal.style.transform = 'none';
        };
        const onUp = () => {
            if (drag) {   // 只有真的拖動過才記住位置
                const r = modal.getBoundingClientRect();
                store.set(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
            }
            drag = null;
        };
        head.addEventListener('mousedown', (e) => {
            const r = modal.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            modal.style.left = r.left + 'px';
            modal.style.top = r.top + 'px';
            modal.style.transform = 'none';
            e.preventDefault();
        });
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
        dragCleanup = () => {
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
        };

        document.addEventListener('keydown', onDialogKey, true);
    }

    // ── 小提示（toast）────────────────────────────────────────────────────
    let toastEl = null, toastTimer = null;
    function toast(msg) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.style.cssText = 'all: initial; position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 2147483647; background: rgba(30,30,30,.95); color: #fff; font-family: Arial, "Microsoft JhengHei", sans-serif; font-size: 14px; padding: 10px 18px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.4); pointer-events: none;';
            document.documentElement.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2200);
    }

    // ── 熱鍵：F1 儲存、F2 讀取 ────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        if (e.key === 'F1') { e.preventDefault(); save(); }
        else if (e.key === 'F2') { e.preventDefault(); load(); }
    }, true);

})();
