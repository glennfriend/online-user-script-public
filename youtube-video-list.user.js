// ==UserScript==
// @name         YouTube 頁面助手
// @namespace    browser-tools
// @version      4.7
// @updateURL    https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-video-list.user.js
// @downloadURL  https://raw.githubusercontent.com/glennfriend/online-user-script-public/main/youtube-video-list.user.js
// @description  浮動助手, 依頁面顯示不同功能選單
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log('[YT助手 v4.7] 腳本已載入，頁面:', location.pathname);

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║                                                                      ║
    // ║   ██ SITE 區塊 — 每個網站不同的部分                                   ║
    // ║   （SETTINGS / PAGE_CONFIGS / Actions / 網站專屬 helpers）            ║
    // ║                                                                      ║
    // ╚════════════════════════════════════════════════════════════════════════╝

    // ── SETTINGS ──────────────────────────────────────────────────────────
    const SETTINGS = {
        ball: { size: 48, color: '#FF0000', icon: '▶', opacity: 0.7, opacityHover: 1 },
        panel: { width: 420, maxHeight: 'calc(100vh - 20px)', bg: '#1e1e1e', color: '#e0e0e0', fontFamily: 'Arial, "Microsoft JhengHei", sans-serif' },
        hotkey: 'F1',
        debug: false,
        logPrefix: '[YT助手]',
        // 分類規則：keywords 同時比對標題和頻道名稱（不分大小寫）
        categoryRules: [
            { tag: '影劇', keywords: ['電影', '影集', '劇集', '前導預告', '預告片', 'trailer', 'netflix', 'disney', '劇情解析', '電影解析', '劇場版', '脱口秀', '單口喜劇', '小品', '喜人奇妙夜', '喜劇大賽', '喜劇之王', 'standupcomedy', '搞笑', '綜藝', '漫畫', '二次元', '動漫', '動畫', '短劇'] },
            { tag: '美食', keywords: ['美食', '食譜', '料理', '進食', '廚師', '餐廳', '泡麵', '甜點', '小吃', '烹飪', '食材', '米其林', '吃到飽', '試吃', '味道'] },
            { tag: '健康', keywords: ['物理治療', 'hiit', 'workout', '健身', '復健', '減脂', '增肌', '牙醫', '慢性發炎', '運動治療', 'psoas', 'cardio', '關節', '內臟脂肪', '醫生', '醫師', '中醫', '營養師', '泌尿'] },
            { tag: 'Game', keywords: ['遊戲', '遊玩', 'steam', '肉鴿', '神魔之塔', '實玩', '試玩', '遊戲推薦', '新手攻略'] },
            { tag: '財經', keywords: ['財經', '美股', '期權', '大盤', '股票', '投資', '基金', '買房', '理財', '做空', '信用卡', '貸款'] },
            { tag: '科技', keywords: ['人工智慧', 'chatgpt', '矽谷', '工程師', '程式設計', '軟體開發', '科技業', 'openai', 'llm', '大模型'] },
        ],
        defaultCategory: '無標籤',
    };

    // ── PAGE_CONFIGS ──────────────────────────────────────────────────────
    // action 用箭頭函式包一層，因為 Actions 定義在下方
    const PAGE_CONFIGS = [
        {
            name: '首頁',
            match: (url) => url.pathname === '/',
            menuItems: [
                { label: '📋 列出所有影片（依時間排序）', action: (r, p) => Actions.listVideosByTime(r, p) },
            ],
        },
        {
            name: '搜尋結果',
            match: (url) => url.pathname === '/results',
            menuItems: [
                { label: '📋 列出搜尋結果影片', action: (r, p) => Actions.listVideosByTime(r, p) },
            ],
        },
        {
            name: '頻道頁',
            match: (url) => url.pathname.startsWith('/@') || url.pathname.startsWith('/channel/') || url.pathname.startsWith('/c/'),
            menuItems: [
                { label: '📋 列出頻道影片', action: (r, p) => Actions.listVideosByTime(r, p) },
            ],
        },
        {
            name: '訂閱內容',
            match: (url) => url.pathname === '/feed/subscriptions',
            menuItems: [
                { label: '📋 列出訂閱影片（依時間排序）', action: (r, p) => Actions.listVideosByTime(r, p) },
            ],
        },
        {
            name: '播放清單',
            match: (url) => url.pathname === '/playlist',
            menuItems: [
                { label: '📋 列出播放清單影片', action: (r, p) => Actions.listVideosByTime(r, p) },
            ],
        },
        {
            name: 'Shorts',
            match: (url) => url.pathname.startsWith('/shorts/'),
            menuItems: [
                { label: '🔄 轉成一般影片頁', hotkey: '1', action: (r, p) => Actions.shortsToWatch(r, p) },
                { label: '🔄 轉成一般影片頁（帶秒數）', hotkey: '2', action: (r, p) => Actions.shortsToWatchAtTime(r, p) },
                { label: '← 往回 5 秒', hotkey: '←', action: (r, p) => Actions.seekVideo(r, p, -5) },
                { label: '→ 往後 5 秒', hotkey: '→', action: (r, p) => Actions.seekVideo(r, p, 5) },
            ],
        },
        // 新增頁面：複製上方任一物件，改 name / match / menuItems
    ];

    // ── Actions（網站專屬動作）─────────────────────────────────────────
    const Actions = {};

    Actions.listVideosByTime = function (_runner, panel) {
        const videos = YouTubeHelpers.collectVideos();
        panel.clear();
        if (videos.length === 0) {
            panel.showEmpty('此頁面沒有找到影片', '請確認頁面已載入影片，或按「重新整理」再試');
            return;
        }

        // 統計各 tag 影片數，建立排序後的 tag 清單
        const tagCounts = new Map();
        videos.forEach(v => v.categories.forEach(cat => tagCounts.set(cat, (tagCounts.get(cat) || 0) + 1)));
        const ALL = 'All';
        const defaultCat = SETTINGS.defaultCategory || '無標籤';
        tagCounts.set(ALL, videos.length);
        const orderedTags = [ALL];
        if (tagCounts.has(defaultCat)) orderedTags.push(defaultCat);
        SETTINGS.categoryRules.forEach(r => { if (tagCounts.has(r.tag)) orderedTags.push(r.tag); });

        let activeTag = tagCounts.has(defaultCat) ? defaultCat : ALL;
        function renderList() {
            panel.clear();
            panel.addTagBar({ tags: orderedTags, activeTag, tagCounts, onTagClick: (tag) => { activeTag = tag; renderList(); } });
            const filtered = activeTag === ALL ? videos : videos.filter(v => v.categories.includes(activeTag));
            filtered.forEach((video, index) => {
                panel.addVideoItem({ index: index + 1, title: video.title, href: video.href, subtitle: video.timeText });
            });
        }
        renderList();
    };

    Actions.shortsToWatch = function (_runner, panel) {
        const m = location.pathname.match(/^\/shorts\/([^/?#]+)/);
        if (!m) { panel.showMessage('無法取得影片 ID'); return; }
        location.href = 'https://www.youtube.com/watch?v=' + m[1];
    };

    Actions.shortsToWatchAtTime = function (_runner, panel) {
        const m = location.pathname.match(/^\/shorts\/([^/?#]+)/);
        if (!m) { panel.showMessage('無法取得影片 ID'); return; }
        const all = Array.from(document.querySelectorAll('video'));
        const video = all.find(v => {
            const r = v.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
        }) || all[0];
        const t = Math.max(0, Math.floor((video ? video.currentTime : 0) - 1));
        location.href = 'https://youtu.be/' + m[1] + '?t=' + t;
    };

    Actions.seekVideo = function (_runner, panel, seconds) {
        // 優先使用 YouTube 內部 player API（/watch 頁最可靠）
        const moviePlayer = document.getElementById('movie_player');
        if (moviePlayer && typeof moviePlayer.seekTo === 'function') {
            moviePlayer.seekTo(Math.max(0, moviePlayer.getCurrentTime() + seconds), true);
            panel.showMessage(seconds > 0 ? `→ 快轉 ${seconds} 秒` : `← 倒退 ${Math.abs(seconds)} 秒`);
            return;
        }
        // Shorts fallback：找視窗內可見的 video 元素
        const all = Array.from(document.querySelectorAll('video'));
        if (!all.length) { panel.showMessage('找不到影片'); return; }
        const video = all.find(v => {
            const r = v.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
        }) || all.find(v => !v.paused) || all[0];
        // 嘗試透過 video 的祖先 .html5-video-player 取得 API
        let playerEl = video.parentElement;
        while (playerEl && playerEl !== document.body) {
            if (playerEl.classList && playerEl.classList.contains('html5-video-player') && typeof playerEl.seekTo === 'function') break;
            playerEl = playerEl.parentElement;
        }
        const before = video.currentTime;
        const newTime = Math.max(0, before + seconds);
        if (playerEl && typeof playerEl.seekTo === 'function') {
            playerEl.seekTo(newTime, true);
        } else if (typeof video.fastSeek === 'function') {
            video.fastSeek(newTime);
        } else {
            video.currentTime = newTime;
        }
        // 顯示診斷資訊（before → target，readyState）
        panel.showMessage(`${before.toFixed(1)}s → ${newTime.toFixed(1)}s  [rs:${video.readyState}]`);
    };

    // ── YouTube 專屬 Helpers ──────────────────────────────────────────
    const YouTubeHelpers = {};

    YouTubeHelpers.collectVideos = function () {
        const videos = [];
        const allLinks = document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]');
        const linksByVideoId = new Map();

        log('找到連結數量:', allLinks.length);

        allLinks.forEach(link => {
            try {
                const href = link.href;
                if (!href) return;
                const url = new URL(href, location.origin);
                const videoId = url.searchParams.get('v') || url.pathname.split('/shorts/')[1];
                if (!videoId) return;
                if (!linksByVideoId.has(videoId)) linksByVideoId.set(videoId, []);
                linksByVideoId.get(videoId).push(link);
            } catch (e) { /* ignore */ }
        });

        linksByVideoId.forEach((links) => {
            try {
                let titleText = '';
                let bestLink = links[0];

                for (const link of links) {
                    let candidate = '';
                    const innerTitle = link.querySelector('#video-title, yt-formatted-string');
                    if (innerTitle) candidate = innerTitle.textContent.trim();
                    if (!candidate) candidate = (link.title || link.getAttribute('aria-label') || '').trim();
                    if (!candidate) candidate = link.textContent.trim();
                    if (/^\d{1,2}(:\d{2}){1,2}$/.test(candidate)) continue;
                    if (/^\d+[,.]?\d*\s*(次觀看|views|subscribers|訂閱者)$/i.test(candidate)) continue;
                    if (candidate.length < 4) continue;
                    if (candidate.length > titleText.length) { titleText = candidate; bestLink = link; }
                }

                if (!titleText) {
                    for (const link of links) {
                        const container = YouTubeHelpers.findContainer(link);
                        if (container) {
                            const titleEl = container.querySelector('#video-title, [id*="video-title"], h3 a, h3');
                            if (titleEl) {
                                const t = titleEl.textContent.trim();
                                if (t.length >= 4 && !/^\d{1,2}(:\d{2}){1,2}$/.test(t)) { titleText = t; bestLink = link; break; }
                            }
                        }
                    }
                }

                if (!titleText || titleText.length < 2) return;

                const timeText = YouTubeHelpers.findTimeText(bestLink);
                const channel = YouTubeHelpers.collectChannelName(bestLink);
                log('找到影片:', titleText, '|', timeText, '|', channel);
                videos.push({ title: titleText, href: bestLink.href, timeText: timeText || '未知時間', timeMinutes: YouTubeHelpers.parseTime(timeText), channel, categories: YouTubeHelpers.categorize(titleText, channel) });
            } catch (e) { log('解析錯誤:', e); }
        });

        videos.sort((a, b) => a.timeMinutes - b.timeMinutes);
        log('最終影片數:', videos.length);
        return videos;
    };

    YouTubeHelpers.findContainer = function (el) {
        let current = el;
        for (let i = 0; i < 10; i++) {
            current = current.parentElement;
            if (!current) return null;
            const tag = current.tagName.toLowerCase();
            if (tag.startsWith('ytd-') && tag.includes('renderer')) return current;
        }
        return null;
    };

    YouTubeHelpers.findTimeText = function (link) {
        const container = YouTubeHelpers.findContainer(link);
        if (!container) return '';
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text && YouTubeHelpers.isTimeText(text)) return text;
        }
        for (const sel of ['#metadata-line span', '[class*="published-time"]', '.inline-metadata-item', 'span[class*="time"]']) {
            for (const el of container.querySelectorAll(sel)) {
                const text = el.textContent.trim();
                if (YouTubeHelpers.isTimeText(text)) return text;
            }
        }
        return '';
    };

    YouTubeHelpers.isTimeText = function (text) {
        if (!text || text.length > 50) return false;
        return /前|ago|streamed|直播|premiered|首播|直播時間/i.test(text);
    };

    YouTubeHelpers.parseTime = function (text) {
        if (!text) return Infinity;
        text = text.toLowerCase().trim().replace(/^(streamed|已直播|直播時間：?|premiered|首播)\s*/i, '');
        const patterns = [
            [/(\d+)\s*秒/, 1/60], [/(\d+)\s*分鐘/, 1], [/(\d+)\s*小時/, 60], [/(\d+)\s*天/, 1440],
            [/(\d+)\s*週/, 10080], [/(\d+)\s*個月/, 43200], [/(\d+)\s*年/, 525600],
            [/(\d+)\s*second/, 1/60], [/(\d+)\s*minute/, 1], [/(\d+)\s*hour/, 60], [/(\d+)\s*day/, 1440],
            [/(\d+)\s*week/, 10080], [/(\d+)\s*month/, 43200], [/(\d+)\s*year/, 525600],
        ];
        for (const [regex, mult] of patterns) {
            const m = text.match(regex);
            if (m) return parseInt(m[1], 10) * mult;
        }
        return Infinity;
    };

    YouTubeHelpers.collectChannelName = function (link) {
        const container = YouTubeHelpers.findContainer(link);
        if (!container) return '';
        for (const sel of ['#channel-name a', '#channel-name yt-formatted-string', 'ytd-channel-name a']) {
            const el = container.querySelector(sel);
            if (el) { const t = el.textContent.trim(); if (t) return t; }
        }
        return '';
    };

    YouTubeHelpers.categorize = function (title, channel) {
        const rules = SETTINGS.categoryRules;
        if (!rules || !rules.length) return [SETTINGS.defaultCategory || '無標籤'];
        const combined = (title + ' ' + channel).toLowerCase();
        const matched = [];
        for (const rule of rules) {
            for (const kw of rule.keywords) {
                if (combined.includes(kw)) { matched.push(rule.tag); break; }
            }
        }
        return matched.length > 0 ? matched : [SETTINGS.defaultCategory || '無標籤'];
    };

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║                                                                      ║
    // ║   ██ CORE 區塊 — 所有網站共用，不要改這裡                             ║
    // ║   （log / ActionRunner / PanelAPI / FloatingBall / Panel / Router）   ║
    // ║                                                                      ║
    // ║   未來轉 bundler 時，這整段直接搬成 core.js                           ║
    // ║                                                                      ║
    // ╚════════════════════════════════════════════════════════════════════════╝

    // ── log ───────────────────────────────────────────────────────────────
    function log(...args) {
        if (SETTINGS.debug) console.log(SETTINGS.logPrefix, ...args);
    }

    // ── ActionRunner ──────────────────────────────────────────────────────
    const ActionRunner = {
        async click(selector) {
            const el = document.querySelector(selector);
            if (!el) throw new Error('找不到元素: ' + selector);
            el.click(); log('click:', selector);
        },
        async type(selector, text) {
            const el = document.querySelector(selector);
            if (!el) throw new Error('找不到元素: ' + selector);
            el.focus(); el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            log('type:', selector, text);
        },
        async wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
        async waitFor(selector, timeout = 10000) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                if (document.querySelector(selector)) { log('waitFor found:', selector); return document.querySelector(selector); }
                await this.wait(200);
            }
            throw new Error('等待逾時: ' + selector);
        },
        async sequence(steps) {
            for (const step of steps) {
                if (typeof step === 'function') { await step(); }
                else if (step.do === 'click') { await this.click(step.selector); }
                else if (step.do === 'type') { await this.type(step.selector, step.text); }
                else if (step.do === 'wait') { await this.wait(step.ms); }
                else if (step.do === 'waitFor') { await this.waitFor(step.selector, step.timeout); }
            }
        },
    };

    // ── PanelAPI ──────────────────────────────────────────────────────────
    function createPanelAPI(listEl, countEl) {
        return {
            clear() {
                while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
                countEl.textContent = '';
            },
            setCount(text) { countEl.textContent = text; },
            showEmpty(title, hint) {
                this.clear();
                const box = document.createElement('div');
                Object.assign(box.style, { padding: '20px', textAlign: 'center', color: '#888', fontSize: '13px', lineHeight: '1.6' });
                box.appendChild(document.createTextNode(title));
                if (hint) {
                    box.appendChild(document.createElement('br'));
                    const small = document.createElement('span');
                    small.style.fontSize = '11px'; small.style.color = '#666'; small.textContent = hint;
                    box.appendChild(small);
                }
                listEl.appendChild(box);
            },
            showMessage(text) {
                this.clear();
                const box = document.createElement('div');
                Object.assign(box.style, { padding: '16px', textAlign: 'center', color: '#4CAF50', fontSize: '13px' });
                box.textContent = text; listEl.appendChild(box);
            },
            addVideoItem({ index, title, href, subtitle }) {
                const item = document.createElement('div');
                Object.assign(item.style, { padding: '12px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: '10px', alignItems: 'flex-start', transition: 'background 0.15s' });
                item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#2a2a2a'; });
                item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
                const num = document.createElement('span');
                Object.assign(num.style, { color: '#888', fontSize: '13px', flexShrink: '0', minWidth: '26px', paddingTop: '2px' });
                num.textContent = index + '.';
                let thumbEl = null;
                try {
                    const u = new URL(href);
                    const vid = u.searchParams.get('v') || u.pathname.split('/shorts/')[1];
                    if (vid) {
                        thumbEl = document.createElement('img');
                        thumbEl.src = `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
                        Object.assign(thumbEl.style, { width: '120px', height: '68px', objectFit: 'cover', borderRadius: '4px', flexShrink: '0' });
                    }
                } catch(e) {}
                const content = document.createElement('div');
                content.style.flexGrow = '1'; content.style.minWidth = '0';
                const link = document.createElement('a');
                link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.textContent = title;
                Object.assign(link.style, { color: '#e0e0e0', textDecoration: 'none', fontSize: '15px', lineHeight: '1.5', display: 'block', wordBreak: 'break-word' });
                link.addEventListener('mouseenter', () => { link.style.color = '#3ea6ff'; });
                link.addEventListener('mouseleave', () => { link.style.color = '#e0e0e0'; });
                content.appendChild(link);
                if (subtitle) {
                    const sub = document.createElement('span');
                    Object.assign(sub.style, { color: '#aaa', fontSize: '12px', marginTop: '4px', display: 'block' });
                    sub.textContent = subtitle; content.appendChild(sub);
                }
                item.appendChild(num); if (thumbEl) item.appendChild(thumbEl); item.appendChild(content); listEl.appendChild(item);
            },
            addTagBar({ tags, activeTag, tagCounts, onTagClick }) {
                const bar = document.createElement('div');
                Object.assign(bar.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px', borderBottom: '1px solid #2a2a2a', position: 'sticky', top: '0', backgroundColor: SETTINGS.panel.bg, zIndex: '1', alignItems: 'center' });
                tags.forEach(tag => {
                    const isActive = tag === activeTag;
                    const btn = document.createElement('button');
                    const count = tagCounts && tagCounts.get(tag);
                    btn.textContent = count != null ? `${tag} (${count})` : tag;
                    Object.assign(btn.style, { background: isActive ? SETTINGS.ball.color : '#333', color: '#fff', border: 'none', borderRadius: '12px', padding: '3px 10px', fontSize: '12px', cursor: 'default', transition: 'background 0.15s' });
                    btn.addEventListener('mouseenter', () => { if (tag !== activeTag) onTagClick(tag); });
                    bar.appendChild(btn);
                });
                const refreshBtn = document.createElement('button');
                refreshBtn.textContent = '重新整理';
                Object.assign(refreshBtn.style, { marginLeft: 'auto', background: 'none', border: '1px solid #555', color: '#ccc', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: '12px', flexShrink: '0', transition: 'border-color 0.15s' });
                refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); showMenuOrRun(currentConfig); });
                refreshBtn.addEventListener('mouseenter', () => { refreshBtn.style.borderColor = '#fff'; });
                refreshBtn.addEventListener('mouseleave', () => { refreshBtn.style.borderColor = '#555'; });
                bar.appendChild(refreshBtn);
                listEl.insertBefore(bar, listEl.firstChild);
            },
            addTextItem({ text, hotkey, onClick }) {
                const item = document.createElement('div');
                Object.assign(item.style, { padding: '10px 16px', borderBottom: '1px solid #2a2a2a', cursor: onClick ? 'pointer' : 'default', transition: 'background 0.15s', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start' });
                const label = document.createElement('span');
                label.textContent = text;
                if (hotkey) {
                    const badge = document.createElement('span');
                    badge.textContent = hotkey;
                    Object.assign(badge.style, { fontSize: '10px', color: '#fff', backgroundColor: '#333', border: '1px solid #555', borderRadius: '3px', padding: '1px 5px', marginRight: '8px', flexShrink: '0', fontFamily: 'monospace' });
                    item.appendChild(badge);
                }
                item.appendChild(label);
                item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#2a2a2a'; });
                item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
                if (onClick) item.addEventListener('click', onClick);
                listEl.appendChild(item);
            },
        };
    }

    // ── FloatingBall ──────────────────────────────────────────────────────
    let ballEl = null, panelEl = null, panelAPI = null;
    let isDragging = false, dragOffset = { x: 0, y: 0 }, hasMoved = false;
    let currentConfig = null;

    function createBall() {
        if (document.getElementById('bh-ball')) return;
        const s = SETTINGS.ball;
        ballEl = document.createElement('div');
        ballEl.id = 'bh-ball';
        Object.assign(ballEl.style, {
            position: 'fixed', width: s.size + 'px', height: s.size + 'px',
            borderRadius: '50%', backgroundColor: s.color, color: '#fff', fontSize: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'grab', zIndex: '999999', boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
            userSelect: 'none', transition: 'opacity 0.2s', opacity: String(s.opacity),
        });
        ballEl.textContent = s.icon;
        const savedPos = GM_getValue('bh_ball_position', null);
        if (savedPos) { ballEl.style.top = savedPos.top; ballEl.style.left = savedPos.left; ballEl.style.right = 'auto'; }
        else { ballEl.style.top = '80px'; ballEl.style.right = '20px'; }

        const tip = document.createElement('div');
        tip.textContent = SETTINGS.hotkey;
        Object.assign(tip.style, { position: 'absolute', bottom: '-20px', left: '50%', transform: 'translateX(-50%)', fontSize: '10px', color: '#fff', backgroundColor: '#333', borderRadius: '3px', padding: '1px 5px', opacity: '0', transition: 'opacity 0.2s', pointerEvents: 'none', whiteSpace: 'nowrap' });
        ballEl.appendChild(tip);

        ballEl.addEventListener('mouseenter', () => { ballEl.style.opacity = String(s.opacityHover); tip.style.opacity = '1'; });
        ballEl.addEventListener('mouseleave', () => { if (!isDragging) ballEl.style.opacity = String(s.opacity); tip.style.opacity = '0'; });
        ballEl.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        ballEl.addEventListener('click', (e) => { if (hasMoved) return; e.stopPropagation(); togglePanel(); });
        document.addEventListener('keydown', (e) => { if (e.key === SETTINGS.hotkey) { e.preventDefault(); e.stopPropagation(); if (currentConfig) togglePanel(); } });
        document.body.appendChild(ballEl);
    }

    function onDragStart(e) {
        isDragging = true; hasMoved = false;
        const rect = ballEl.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left; dragOffset.y = e.clientY - rect.top;
        ballEl.style.cursor = 'grabbing'; ballEl.style.transition = 'none'; e.preventDefault();
    }
    function onDragMove(e) {
        if (!isDragging) return; hasMoved = true;
        const s = SETTINGS.ball;
        ballEl.style.left = Math.max(0, Math.min(window.innerWidth - s.size, e.clientX - dragOffset.x)) + 'px';
        ballEl.style.top = Math.max(0, Math.min(window.innerHeight - s.size, e.clientY - dragOffset.y)) + 'px';
        ballEl.style.right = 'auto';
    }
    function onDragEnd() {
        if (!isDragging) return; isDragging = false;
        ballEl.style.cursor = 'grab'; ballEl.style.transition = 'opacity 0.2s';
        GM_setValue('bh_ball_position', { top: ballEl.style.top, left: ballEl.style.left });
    }

    // 全螢幕時隱藏浮球與面板
    document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        if (ballEl) ballEl.style.display = isFs ? 'none' : (currentConfig ? 'flex' : 'none');
        if (panelEl && isFs) panelEl.style.display = 'none';
    });

    // ── Panel ─────────────────────────────────────────────────────────────
    function createPanel() {
        const p = SETTINGS.panel;
        panelEl = document.createElement('div');
        panelEl.id = 'bh-panel';
        const savedWidth = GM_getValue('bh_panel_width', p.width);
        Object.assign(panelEl.style, {
            position: 'fixed', top: '10px', right: '20px', width: savedWidth + 'px', maxHeight: p.maxHeight,
            backgroundColor: p.bg, color: p.color, borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: '999998', display: 'none', flexDirection: 'column', overflow: 'hidden', fontFamily: p.fontFamily,
        });
        // 左側拖曳條
        const resizeHandle = document.createElement('div');
        Object.assign(resizeHandle.style, { position: 'absolute', left: '0', top: '0', width: '6px', height: '100%', cursor: 'ew-resize', zIndex: '1', borderRadius: '12px 0 0 12px' });
        resizeHandle.addEventListener('mouseenter', () => { resizeHandle.style.backgroundColor = 'rgba(255,255,255,0.15)'; });
        resizeHandle.addEventListener('mouseleave', () => { resizeHandle.style.backgroundColor = 'transparent'; });
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX;
            const startWidth = panelEl.offsetWidth;
            const onMove = (e) => {
                const newWidth = Math.max(280, Math.min(window.innerWidth - 40, startWidth + (startX - e.clientX)));
                panelEl.style.width = newWidth + 'px';
            };
            const onUp = () => {
                GM_setValue('bh_panel_width', panelEl.offsetWidth);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        panelEl.appendChild(resizeHandle);
        const countBadge = document.createElement('span'); // 保留供 setCount() API 使用
        const listContainer = document.createElement('div');
        listContainer.id = 'bh-list';
        Object.assign(listContainer.style, { overflowY: 'auto', padding: '8px 0', flexGrow: '1' });
        panelEl.appendChild(listContainer);
        document.body.appendChild(panelEl);
        panelAPI = createPanelAPI(listContainer, countBadge);
    }

    function togglePanel() {
        if (!panelEl) createPanel();
        if (panelEl.style.display === 'flex') { panelEl.style.display = 'none'; }
        else { panelEl.style.display = 'flex'; showMenuOrRun(currentConfig); }
    }

    function showMenuOrRun(config) {
        if (!config || !panelAPI) return;
        const titleEl = document.getElementById('bh-title');
        if (titleEl) titleEl.textContent = config.name;
        const items = config.menuItems;
        if (items.length === 1) {
            panelAPI.clear();
            Promise.resolve(items[0].action(ActionRunner, panelAPI)).catch(err => { panelAPI.showMessage('❌ 執行失敗: ' + err.message); });
            return;
        }
        panelAPI.clear(); panelAPI.setCount(items.length + ' 項功能');
        items.forEach(item => {
            panelAPI.addTextItem({ text: item.label, hotkey: item.hotkey, onClick: () => {
                panelAPI.clear(); panelAPI.setCount('');
                Promise.resolve(item.action(ActionRunner, panelAPI)).catch(err => { panelAPI.showMessage('❌ 執行失敗: ' + err.message); });
            }});
        });
    }

    document.addEventListener('click', (e) => {
        if (!panelEl || panelEl.style.display !== 'flex') return;
        if (panelEl.contains(e.target) || ballEl.contains(e.target)) return;
        panelEl.style.display = 'none';
    });

    // ── Router ────────────────────────────────────────────────────────────
    function findMatchingConfig() {
        const url = new URL(location.href);
        for (const config of PAGE_CONFIGS) { if (config.match(url)) return config; }
        return null;
    }

    function onNavigate() {
        currentConfig = findMatchingConfig();
        if (currentConfig) { log('匹配頁面:', currentConfig.name); createBall(); if (ballEl) ballEl.style.display = 'flex'; }
        else { log('無匹配頁面'); if (ballEl) ballEl.style.display = 'none'; if (panelEl) panelEl.style.display = 'none'; }
    }

    const _pushState = history.pushState;
    history.pushState = function () { _pushState.apply(this, arguments); setTimeout(onNavigate, 500); };
    window.addEventListener('popstate', () => setTimeout(onNavigate, 500));
    window.addEventListener('yt-navigate-finish', () => setTimeout(onNavigate, 500));

    // Shorts 專用：在 capture 階段攔截 ← → 鍵，改為 seek（避免 YouTube 把它當成切換影片）
    document.addEventListener('keydown', (e) => {
        if (!currentConfig || currentConfig.name !== 'Shorts') return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const secs = e.key === 'ArrowLeft' ? -5 : 5;
        const all = Array.from(document.querySelectorAll('video'));
        const video = all.find(v => {
            const r = v.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
        }) || all[0];
        if (video) video.currentTime = Math.max(0, video.currentTime + secs);
    }, true); // true = capture，比 YouTube bubble 監聽器更早觸發

    // Shorts 專用：面板開啟時，按 1/2 觸發轉換功能
    document.addEventListener('keydown', (e) => {
        if (!currentConfig || currentConfig.name !== 'Shorts') return;
        if (!panelEl || panelEl.style.display !== 'flex') return;
        if (e.key === '1') { e.preventDefault(); Actions.shortsToWatch(ActionRunner, panelAPI); }
        else if (e.key === '2') { e.preventDefault(); Actions.shortsToWatchAtTime(ActionRunner, panelAPI); }
        else if (e.key === '3') { e.preventDefault(); Actions.seekVideo(ActionRunner, panelAPI, -5); }
        else if (e.key === '4') { e.preventDefault(); Actions.seekVideo(ActionRunner, panelAPI, 5); }
    });

    onNavigate();

})();