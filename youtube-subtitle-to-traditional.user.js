// ==UserScript==
// @name         YouTube 字幕自動轉繁體
// @name:en      YouTube Auto Switch to Traditional Chinese Subtitles
// @namespace    https://github.com/glennguan/youtube-subtitle-to-traditional
// @version      2.0.0
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-subtitle-to-traditional.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-subtitle-to-traditional.user.js
// @description  看 YouTube 時，若目前中文字幕不是繁體（含被標成通用 zh 的簡體）：有繁體字幕軌就切過去；沒有但可翻譯就自動翻成繁體中文（zh-Hant）。全程盯場，廣告結束、稍後才播放、字幕稍後才開啟等情況都會補轉。
// @author       Glenn
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * YouTube 字幕自動轉繁體 — 使用說明
 * ============================================================================
 * 用途：看 YouTube 時，若字幕是簡體中文，自動換成繁體：
 *        1) 有原生繁體字幕軌 → 直接切過去。
 *        2) 沒有但該軌可翻譯 → 自動翻成繁體中文（zh-Hant）。
 *       非中文字幕、已經是繁體、沒開字幕 → 完全不動作。
 *
 * ── 為什麼是「全程盯場」而不是只在載入時轉一次 ──────────────────────────
 * v1 只在頁面載入後盯場 25 秒就停止，實測發現「字幕被設成簡體」這件事常發生在
 * 那個時間窗之外，於是就出現「有時要重新整理好幾次才會轉」：
 *   - 瀏覽器阻擋自動播放時，字幕要等使用者按播放才會啟用（可能遠超過 25 秒）。
 *   - 前置／中插廣告播完後，播放器會把字幕軌重置回預設（簡體）。
 *   - 有些情況字幕是稍後才被開啟的。
 * 因此 v2 改成：
 *   - 常態每 1.5 秒檢查一次，整個頁面生命週期都不停（成本極低，只讀播放器選項）。
 *   - 遇到關鍵事件時進入「快檢期」（12 秒內每 0.4 秒一次），立刻補轉。
 *   - 關鍵事件用播放器的真實事件，而不是猜時間：
 *       onStateChange（播放／暫停／廣告結束）、onApiChange（字幕模組載入完成）、
 *       yt-navigate-finish / yt-page-data-updated（SPA 換頁），
 *       以及偵測到 video_id 改變（換影片）。
 *   - 若播放器還沒載入字幕模組，主動呼叫 loadModule('captions') 推它一把。
 *
 * 行為說明：因為是全程盯場，若你「手動」把字幕切成簡體，它也會被轉回繁體
 *   —— 這是這支腳本的目的（永遠繁體）。想暫時看簡體請先停用腳本。
 *
 * 外部相依（YouTube 改版時要調整的地方）：
 *   - 播放器物件 #movie_player 的 getOption / setOption('captions', …) API。
 *   - 事件名稱 onStateChange / onApiChange / yt-navigate-finish。
 * ============================================================================
 */

(function () {
  'use strict';

  // ---- 可調設定 --------------------------------------------------------
  const SLOW_INTERVAL = 1500;  // 常態檢查間隔（毫秒），整個頁面生命週期都在跑
  const FAST_INTERVAL = 400;   // 快檢間隔（毫秒）
  const BURST_MS = 12000;      // 關鍵事件後維持快檢的時間（毫秒）

  // ---- 語言判斷 --------------------------------------------------------
  const TRAD = ['zh-tw', 'zh-hk', 'zh-hant', 'zh-cht'];

  const norm = (c) => (c || '').toLowerCase();
  const isTraditional = (c) => {
    c = norm(c);
    return TRAD.includes(c) || c.includes('hant');
  };
  // 是否為中文字幕（含 YouTube 只標成通用 'zh' 的軌，例如許多中國創作者）。
  // 只要是中文且尚未是繁體，就值得轉繁；非中文一律不碰。
  const isChinese = (c) => {
    c = norm(c);
    return c.startsWith('zh') || c.includes('chinese');
  };

  const LOG = '[繁化字幕]';
  const log = (...a) => console.log(LOG, ...a);

  function getPlayer() {
    return document.getElementById('movie_player') ||
           document.querySelector('.html5-video-player');
  }
  function safeGet(p, key) {
    try { return p.getOption('captions', key); } catch (e) { return null; }
  }

  // ---- 核心：若目前中文字幕還不是繁體，就轉成繁體 ----------------------
  // 已是繁體 / 非中文 / 沒開字幕 / 找不到繁體選項 → 不動作。
  let lastNote = '';        // 避免同樣訊息洗版
  let lastVideoId = null;   // 換影片時重置狀態
  let moduleNudged = false; // 每支影片只推一次 loadModule

  function enforceTraditional() {
    const p = getPlayer();
    if (!p || typeof p.getOption !== 'function') return;

    bindPlayerEvents(p);   // 播放器一出現就掛上事件（只會掛一次）

    // 換影片 → 重置提示與模組推送狀態，並進入快檢
    try {
      const vid = p.getVideoData && p.getVideoData().video_id;
      if (vid && vid !== lastVideoId) {
        lastVideoId = vid;
        lastNote = '';
        moduleNudged = false;
        arm('video-changed');
      }
    } catch (e) { /* getVideoData 尚未可用 */ }

    let current;
    try {
      current = p.getOption('captions', 'track');
    } catch (e) {
      return; // 字幕模組還沒載入
    }

    // 沒有字幕資訊：可能是模組還沒載入 → 主動推一把（每支影片一次）
    if (!current || !current.languageCode) {
      if (!moduleNudged && typeof p.loadModule === 'function') {
        moduleNudged = true;
        try { p.loadModule('captions'); } catch (e) { /* 忽略：純屬加速手段 */ }
      }
      return; // 尚未開啟字幕
    }

    // 目前實際顯示的語言：有翻譯就看翻譯目標，否則看軌道語言
    const transCode = current.translationLanguage && current.translationLanguage.languageCode;
    const effective = transCode || current.languageCode;

    // 已經是繁體（原生或翻譯）→ 不動作
    if (isTraditional(effective)) return;

    // 只處理中文字幕（簡體，或被標成通用 'zh' 的）；非中文不碰
    if (!isChinese(effective)) return;

    // 1) 有原生繁體字幕軌 → 直接切過去
    const tracklist = safeGet(p, 'tracklist') || [];
    const nativeTrad = tracklist.find((t) => isTraditional(t.languageCode));
    if (nativeTrad) {
      p.setOption('captions', 'track', nativeTrad);
      if (lastNote !== 'native') { log('已切換到繁體字幕軌：', nativeTrad.languageCode); lastNote = 'native'; }
      return;
    }

    // 2) 沒有原生繁體，但可翻譯 → 翻成繁體
    if (current.is_translateable !== false) {
      const transLangs = safeGet(p, 'translationLanguages') || [];
      const tradTrans = transLangs.find((l) => isTraditional(l.languageCode));
      if (tradTrans) {
        p.setOption('captions', 'track', Object.assign({}, current, { translationLanguage: tradTrans }));
        if (lastNote !== 'trans') { log('已將字幕翻譯為繁體中文：', tradTrans.languageCode); lastNote = 'trans'; }
        return;
      }
    }

    if (lastNote !== 'none') { log('此影片找不到繁體字幕或繁體翻譯選項。'); lastNote = 'none'; }
  }

  // ---- 盯場：常態慢檢 + 事件觸發的快檢 --------------------------------
  let fastTimer = null;
  let burstUntil = 0;

  function arm(reason) {
    burstUntil = Date.now() + BURST_MS;
    if (!fastTimer) {
      fastTimer = setInterval(() => {
        enforceTraditional();
        if (Date.now() > burstUntil) { clearInterval(fastTimer); fastTimer = null; }
      }, FAST_INTERVAL);
    }
    enforceTraditional(); // 立即先跑一次
    if (reason) log('進入快檢：', reason);
  }

  // 常態盯場：整個頁面生命週期都不停。只是讀取播放器選項，成本極低。
  setInterval(enforceTraditional, SLOW_INTERVAL);

  // ---- 播放器事件（比猜時間可靠）---------------------------------------
  let boundPlayer = null;
  function bindPlayerEvents(p) {
    if (boundPlayer === p || typeof p.addEventListener !== 'function') return;
    boundPlayer = p;
    // onStateChange：播放 / 暫停 / 廣告結束後真正開始播都會觸發
    try { p.addEventListener('onStateChange', () => arm('player-state')); } catch (e) { /* 版本差異 */ }
    // onApiChange：播放器模組（含 captions）載入完成時觸發
    try { p.addEventListener('onApiChange', () => arm('api-change')); } catch (e) { /* 版本差異 */ }
  }

  // ---- YouTube SPA 導航事件 -------------------------------------------
  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((ev) => {
    window.addEventListener(ev, () => arm(ev));
    document.addEventListener(ev, () => arm(ev));
  });

  arm('initial-load');
})();
