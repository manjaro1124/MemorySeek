/**
 * interceptor.js - Content Script (网络请求拦截桥梁)
 * 
 * 职责：
 * 1. 将 injected.js 注入到页面上下文中
 * 2. 监听来自 injected.js 的 postMessage
 * 3. 将拦截到的数据转发给 background service worker
 */

(function () {
    'use strict';

    // 注入脚本到页面上下文
    function injectScript() {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/injected.js');
        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    }

    // 监听来自 injected.js 的消息
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== 'MEMORYKEEPER_INTERCEPTED') return;

        // 转发给 background service worker
        chrome.runtime.sendMessage({
            action: 'API_DATA_CAPTURED',
            payload: event.data.payload
        }).catch(() => {
            // background worker 可能未就绪，忽略
        });
    });

    // 注入脚本
    injectScript();

    console.log('[MemorySeek] Content Script (interceptor) 已就绪 ✓');
})();
