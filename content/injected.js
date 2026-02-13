/**
 * injected.js - 注入到页面上下文中的脚本
 * 用于拦截 fetch 和 XMLHttpRequest 请求，捕获豆包的 API 响应数据
 * 
 * 注意：此脚本运行在页面上下文中（非 content script 隔离环境），
 * 通过 window.postMessage 与 content script 通信
 */

(function () {
    'use strict';

    const DOUBAO_API_PATTERNS = [
        /\/api\/.*conversation/i,
        /\/api\/.*chat/i,
        /\/api\/.*message/i,
        /\/api\/.*history/i,
        /\/api\/.*session/i,
        /\/alice\/.*conversation/i,
        /\/alice\/.*message/i,
        /\/samantha\/.*chat/i,
        /\/samantha\/.*message/i,
        /\/samantha\/.*conversation/i,
    ];

    const MSG_TYPE = 'MEMORYKEEPER_INTERCEPTED';

    function isTargetUrl(url) {
        if (!url) return false;
        try {
            const u = new URL(url, location.origin);
            if (!u.hostname.includes('doubao.com') && !u.hostname.includes('volcengine') && !u.hostname.includes('byteintl')) {
                return false;
            }
            return DOUBAO_API_PATTERNS.some(p => p.test(u.pathname));
        } catch {
            return false;
        }
    }

    function sendToContentScript(data) {
        window.postMessage({
            type: MSG_TYPE,
            payload: data
        }, '*');
    }

    function tryParseJson(text) {
        try {
            return JSON.parse(text);
        } catch {
            // 有些返回是 streaming 格式（每行一个 JSON），逐行解析
            const results = [];
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('event:')) continue;
                const cleaned = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
                if (!cleaned || cleaned === '[DONE]') continue;
                try {
                    results.push(JSON.parse(cleaned));
                } catch { /* 忽略非 JSON 行 */ }
            }
            return results.length > 0 ? results : null;
        }
    }

    // ==================== Hook Fetch ====================
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const request = args[0];
        const url = typeof request === 'string' ? request : (request instanceof Request ? request.url : '');

        const response = await originalFetch.apply(this, args);

        if (isTargetUrl(url)) {
            try {
                const cloned = response.clone();
                cloned.text().then(text => {
                    const parsed = tryParseJson(text);
                    if (parsed) {
                        sendToContentScript({
                            source: 'fetch',
                            url: url,
                            data: parsed,
                            timestamp: Date.now()
                        });
                    }
                }).catch(() => { });
            } catch { }
        }

        return response;
    };

    // ==================== Hook XMLHttpRequest ====================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._mkUrl = url;
        this._mkMethod = method;
        return originalXHROpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (isTargetUrl(this._mkUrl)) {
            this.addEventListener('load', function () {
                try {
                    const parsed = tryParseJson(this.responseText);
                    if (parsed) {
                        sendToContentScript({
                            source: 'xhr',
                            url: this._mkUrl,
                            method: this._mkMethod,
                            data: parsed,
                            timestamp: Date.now()
                        });
                    }
                } catch { }
            });
        }
        return originalXHRSend.apply(this, args);
    };

    console.log('[MemorySeek] 网络请求拦截器已注入 ✓');
})();
