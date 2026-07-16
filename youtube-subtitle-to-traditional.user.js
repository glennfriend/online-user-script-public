// ==UserScript==
// @name         YouTube 字幕自動轉繁體
// @name:en      YouTube Auto Switch to Traditional Chinese Subtitles
// @namespace    https://github.com/glennguan/youtube-subtitle-to-traditional
// @version      1.1.0
// @description  看 YouTube 時，若目前字幕是簡體中文：有繁體字幕軌就切過去；沒有但可翻譯就自動翻成繁體中文（zh-Hant）。載入後持續盯場，撐過 YouTube 把字幕重置回簡體的情況。
// @author       Glenn
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---- 可調設定 --------------------------------------------------------
  // 每次進入/切換影片後，持續盯場的時間（毫秒）。這段時間內只要字幕變回
  // 簡體就會再轉一次，用來撐過 YouTube 載入後把軌道重置回預設的情況。
  const ENFORCE_MS = 25000;
  const CHECK_INTERVAL = 700; // 每次檢查間隔（毫秒）

  // ---- 語言判斷 --------------------------------------------------------
  const SIMP = ['zh-cn', 'zh-hans', 'zh-sg', 'zh-chs'];
  const TRAD = ['zh-tw', 'zh-hk', 'zh-hant', 'zh-cht'];

  const norm = (c) => (c || '').toLowerCase();
  const isSimplified = (c) => {
    c = norm(c);
    return SIMP.includes(c) || c.includes('hans');
  };
  const isTraditional = (c) => {
    c = norm(c);
    return TRAD.includes(c) || c.includes('hant');
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

  // ---- 核心：若目前字幕是簡體，就轉成繁體 ------------------------------
  // 已是繁體 / 沒開字幕 / 找不到繁體選項 → 不動作。
  let lastNote = ''; // 避免同樣訊息洗版
  function enforceTraditional() {
    const p = getPlayer();
    if (!p || typeof p.getOption !== 'function') return;

    let current;
    try {
      current = p.getOption('captions', 'track');
    } catch (e) {
      return; // 字幕模組還沒載入
    }
    if (!current || !current.languageCode) return; // 尚未開啟字幕

    // 已經是繁體（原生或翻譯）→ 不動作
    const transCode = current.translationLanguage && current.translationLanguage.languageCode;
    if (transCode ? isTraditional(transCode) : isTraditional(current.languageCode)) return;

    // 只處理簡體
    if (!isSimplified(current.languageCode)) return;

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

  // ---- 盯場計時器 ------------------------------------------------------
  let timer = null;
  let deadline = 0;
  function startEnforcing() {
    lastNote = '';
    deadline = Date.now() + ENFORCE_MS;
    if (timer) return; // 已在跑，只延長 deadline 即可
    timer = setInterval(() => {
      enforceTraditional();
      if (Date.now() > deadline) { clearInterval(timer); timer = null; }
    }, CHECK_INTERVAL);
    enforceTraditional(); // 立即先跑一次
  }

  // ---- 綁定 YouTube SPA 導航事件 --------------------------------------
  window.addEventListener('yt-navigate-finish', startEnforcing);
  window.addEventListener('yt-page-data-updated', startEnforcing);
  // 使用者手動變更字幕時也重新盯一下（若切成簡體會被轉回繁體）
  document.addEventListener('yt-navigate-finish', startEnforcing);

  startEnforcing(); // 首次載入
})();
