// ==UserScript==
// @name         表單記憶助手
// @name:en      Form Memory
// @namespace    https://github.com/glennfriend/online-user-script-public
// @version      1.1.0
// @description  在任何有表單的頁面：F1 儲存目前所有 input / select / checkbox / radio 的值（會先跳確認視窗，避免誤按覆蓋），F2 叫出清單，勾選要套用的項目後回寫，並可還原上一版。設定值依網址（host + path）分別記憶。
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

/*
 * 表單記憶助手 — 使用說明
 * ============================================================================
 * 用途：在任何有表單的頁面，快速儲存 / 還原常填的表單設定值。
 *
 * 操作：
 *   F1  儲存目前頁面所有欄位的值（input / select / checkbox / radio / textarea）。
 *       會先跳出「確認視窗」列出將要儲存的內容，按下「儲存」才真的寫入 ——
 *       F1 就在 F2 隔壁又是瀏覽器說明鍵，很容易誤按，這道確認可避免誤存把已經
 *       存好的值蓋掉。若該頁已有設定，視窗上會標明會覆蓋幾筆。
 *   F2  叫出清單視窗，逐項顯示將被套用的值；每項前面有 checkbox（預設全選），
 *       按「讀取」只把有勾選的值回寫到頁面。每列右側有「🗑」可刪除該筆已存的值。
 *       左下角的「↩ 還原上一版」可把設定換回上次改動前的內容。
 *
 * 防誤刪 / 防誤存（雙重保險）：
 *   - 覆蓋前確認：F1 一律先跳確認視窗。
 *   - 上一版備份：任何會改寫已存資料的動作（儲存、刪除單筆）都會先把現有內容
 *     備份成「上一版」。還原是「與目前值互換」，所以可以來回切換，連誤按還原
 *     也救得回來。
 *
 * 行為細節：
 *   - 只記「有值」的欄位：空白輸入框、未勾選的 checkbox 不會被記，清單保持乾淨。
 *     也就是 F2 只會「幫你填上」，不會「幫你清空」。
 *   - 不記密碼（type=password）與檔案 / 隱藏 / 按鈕類欄位。
 *   - 回寫時會觸發 input / change 事件，React / Vue 等框架表單也吃得到。
 *   - 設定值依網址（host + path）分開儲存；視窗位置全站共用一份。
 *   - 視窗可拖拉標題列移動；會記住上次位置，若超出視界則回到預設置中。
 *
 * 儲存：優先用 GM_setValue / GM_getValue，無 GM 時退回 localStorage。
 *   key 前綴 formmem::；目前值存於 formmem::<host><path>，上一版備份存於同一個
 *   key 加上 ::prev；視窗位置存於 formmem::__dialogpos__。
 *
 * 已知限制：@noframes，故 iframe 內的表單不處理；@exclude YouTube 以免 F1 與
 *   YouTube 頁面助手熱鍵衝突。
 * ============================================================================
 */

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

    // ── 儲存鍵：目前值 + 「上一版」備份（防誤按覆蓋）──────────────────────
    const prevKey = () => pageKey() + '::prev';

    function readSaved(key) {
        try { return JSON.parse(store.get(key, '') || '[]'); } catch (e) { return []; }
    }

    // 任何會改寫已存資料的動作都走這裡：先把現有值備份成「上一版」，再寫入。
    // 因此誤存 / 誤刪都能從 F2 視窗的「還原上一版」救回來。
    function writeSaved(entries) {
        const existing = store.get(pageKey(), '');
        if (existing) store.set(prevKey(), existing);
        store.set(pageKey(), JSON.stringify(entries));
    }

    // ── F1：儲存（先跳確認視窗，避免誤按就覆蓋已存好的值）──────────────────
    function save() {
        const entries = collectFields();
        if (!entries.length) { toast('這個頁面沒有可儲存的表單欄位'); return; }
        showSaveDialog(entries);
    }

    // ── F2：讀取（先跳清單）──────────────────────────────────────────────
    function load() {
        const entries = readSaved(pageKey());
        if (!entries.length) { toast('這個頁面還沒有已儲存的設定，請先按 F1 儲存'); return; }
        showLoadDialog(entries);
    }

    // ── 還原上一版：與目前值互換，所以可以來回切換（誤按還原也救得回來）─────
    function restorePrev() {
        const prev = store.get(prevKey(), '');
        if (!prev) { toast('沒有可還原的上一版'); return; }
        const cur = store.get(pageKey(), '');
        store.set(pageKey(), prev);
        store.set(prevKey(), cur);
        closeDialog();
        toast('已還原上一版');
        load();                       // 重新開清單，直接看到還原後的內容
    }

    // ╔══ 共用視窗 ══════════════════════════════════════════════════════════
    // 「儲存確認」與「讀取清單」兩個視窗共用同一套外觀與行為（拖拉、記住位置、
    // Esc 關閉），只有內容與底部按鈕不同，避免兩份重複的 UI 程式。
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

    /* 配色取自 Radix Colors（dark：slate 中性 + blue 主色），依 12 階語意對應：
       surface=slate2、border/hover=白色 alpha、text-hi=slate12、text-lo=slate11、
       accent=blue9、accent-hover=blue10、value=blue11。皆符合 WCAG 對比。 */
    const MODAL_CSS = `
        :host {
            --surface: #1a1b1e;              /* 不透明面板底色（近 Radix slate2）*/
            --border: rgba(255,255,255,.08); /* 分隔線 / 邊框 */
            --hover: rgba(255,255,255,.06);  /* 列 hover 底 */
            --text-hi: #edeef0;              /* slate12：主要文字 */
            --text-lo: #b0b4ba;              /* slate11：次要文字 */
            --accent: #0a68c0;               /* 主色（按鈕 / 勾選）：白字達 WCAG AA（5.59:1）*/
            --accent-hover: #1372d4;         /* 按鈕 hover：仍達 AA（4.79:1）且較亮做回饋 */
            --value: #70b8ff;                /* blue11：值文字（對比 8.37:1）*/
            --warn: #ffb224;                 /* 覆蓋提醒（amber）*/
        }
        .modal { pointer-events: auto; position: fixed; top: 15vh; left: 50%; transform: translateX(-50%); width: 480px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px); background: var(--surface); color: var(--text-hi); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.55); display: flex; flex-direction: column; overflow: hidden; font-family: -apple-system, "Segoe UI", Roboto, "Microsoft JhengHei", Arial, sans-serif; font-size: 14px; }
        .head { padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: move; user-select: none; }
        .head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-hi); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .head .host { color: var(--text-lo); font-weight: 400; font-size: 13px; }
        .tools { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-lo); }
        .warn { padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--warn); }
        .list { overflow-y: auto; padding: 6px; flex: 1; }
        .row { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 8px; cursor: pointer; }
        .row.ro { cursor: default; }
        .row:hover { background: var(--hover); }
        input[type=checkbox] { width: 16px; height: 16px; flex: 0 0 auto; margin: 0; cursor: pointer; accent-color: var(--accent); }
        .row .lbl { flex: 0 0 34%; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .val { flex: 1; color: var(--value); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .del { flex: 0 0 auto; font-size: 13px; line-height: 1; padding: 4px 6px; border: none; border-radius: 6px; background: transparent; color: var(--text-lo); opacity: .55; cursor: pointer; }
        .row:hover .del { opacity: 1; }
        .row .del:hover { background: rgba(255,255,255,.1); color: #ff9592; }
        .foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--border); }
        button { font-size: 14px; font-weight: 500; padding: 8px 16px; border-radius: 8px; cursor: pointer; transition: background .12s, border-color .12s; }
        button.cancel { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); color: var(--text-hi); }
        button.cancel:hover { background: rgba(255,255,255,.12); }
        button.primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
        button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
        button.ghost { margin-right: auto; background: transparent; border: 1px solid var(--border); color: var(--text-lo); }
        button.ghost:hover { background: rgba(255,255,255,.08); color: var(--text-hi); }
    `;

    // 開一個視窗；innerHTML 需自帶 .modal（內含 .head）結構。
    // host 覆蓋整頁但不吃滑鼠事件（pointer-events: none），只有 modal 本身可互動，
    // 因此不會蓋住、也不會變暗背景頁面。
    function openModal(innerHTML) {
        closeDialog();
        hostEl = document.createElement('div');
        hostEl.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
        const shadow = hostEl.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>' + MODAL_CSS + '</style>' + innerHTML;
        document.documentElement.appendChild(hostEl);

        const $ = (sel) => shadow.querySelector(sel);
        makeDraggable($('.modal'), $('.head'));
        document.addEventListener('keydown', onDialogKey, true);
        return { shadow, $ };
    }

    // 拖拉標題列移動視窗；放開時記住位置
    function makeDraggable(modal, head) {
        if (!modal || !head) return;
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
    }

    const hostLabel = () => esc(location.host + location.pathname);

    // ── F1 的確認視窗：列出將要儲存的值，按下「儲存」才真的寫入 ─────────────
    function showSaveDialog(entries) {
        const existing = readSaved(pageKey());
        const rows = entries.map((e) => `
            <div class="row ro">
                <span class="lbl">${esc(e.label)}</span>
                <span class="val" title="${esc(e.display)}">${esc(e.display)}</span>
            </div>`).join('');

        const warn = existing.length
            ? `<div class="warn">⚠ 這個頁面已存有 ${existing.length} 筆設定，儲存後會被覆蓋（可在 F2 視窗按「還原上一版」救回）。</div>`
            : '';

        const { $ } = openModal(`
            <div class="modal">
                <div class="head">
                    <h2>儲存表單設定 (${entries.length}) <span class="host">by ${hostLabel()}</span></h2>
                </div>
                ${warn}
                <div class="list">${rows}</div>
                <div class="foot">
                    <button class="cancel">取消</button>
                    <button class="primary do-save">儲存</button>
                </div>
            </div>`);

        $('.cancel').addEventListener('click', closeDialog);
        $('.do-save').addEventListener('click', () => {
            writeSaved(entries);
            closeDialog();
            toast(`已儲存 ${entries.length} 個欄位設定`);
            log('已儲存', entries);
        });
    }

    // ── F2 的清單視窗：勾選要套用的項目後回寫 ──────────────────────────────
    function showLoadDialog(entries) {
        const rows = entries.map((e, i) => `
            <label class="row">
                <input type="checkbox" class="chk" data-i="${i}" checked>
                <span class="lbl">${esc(e.label)}</span>
                <span class="val" title="${esc(e.display)}">${esc(e.display)}</span>
                <button type="button" class="del" data-i="${i}" title="刪除此筆已儲存的值">🗑</button>
            </label>`).join('');

        const hasPrev = !!store.get(prevKey(), '');
        const restoreBtn = hasPrev ? '<button class="ghost restore" title="把設定換回上一次儲存前的內容">↩ 還原上一版</button>' : '';

        const { shadow, $ } = openModal(`
            <div class="modal">
                <div class="head">
                    <h2>表單設定 (<span class="cnt">${entries.length}</span>) <span class="host">by ${hostLabel()}</span></h2>
                </div>
                <div class="tools">
                    <input type="checkbox" id="all" checked>
                    <label for="all">全選 / 全不選</label>
                </div>
                <div class="list">${rows}</div>
                <div class="foot">
                    ${restoreBtn}
                    <button class="cancel">取消</button>
                    <button class="primary apply">讀取（套用勾選項目）</button>
                </div>
            </div>`);

        const chks = () => Array.from(shadow.querySelectorAll('.chk'));

        $('.cancel').addEventListener('click', closeDialog);
        if (hasPrev) $('.restore').addEventListener('click', restorePrev);
        $('#all').addEventListener('change', (e) => { chks().forEach((c) => { c.checked = e.target.checked; }); });

        // 每列「🗑 刪除」：把該筆從儲存中移除（同樣先備份成上一版，可還原）
        shadow.querySelectorAll('.del').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation(); // 別觸發 label 的勾選
                btn.closest('.row').remove();
                const remaining = chks().map((c) => entries[+c.dataset.i]);
                writeSaved(remaining);
                const cnt = $('.cnt'); if (cnt) cnt.textContent = remaining.length;
                if (remaining.length === 0) { closeDialog(); toast('已刪除，這個頁面已無儲存的設定'); }
                else { toast('已刪除該筆'); }
            });
        });

        $('.apply').addEventListener('click', () => {
            const selected = chks().filter((c) => c.checked).map((c) => entries[+c.dataset.i]);
            let ok = 0, miss = 0;
            selected.forEach((entry) => { applyEntry(entry) ? ok++ : miss++; });
            closeDialog();
            toast(`已套用 ${ok} 個欄位` + (miss ? `，${miss} 個在頁面上找不到` : ''));
        });
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
