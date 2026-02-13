/**
 * extractor.js - Content Script (DOM 解析提取器)
 * 
 * 适配豆包 (doubao.com) 真实页面结构：
 * - 对话列表: [id^="conversation_"]
 * - 消息内容: [data-testid="message_text_content"]
 * - 用户消息: 父元素含 justify-end 类
 * - AI消息:   含 data-message-id 属性
 */

(function () {
    'use strict';

    function cleanText(text) {
        if (!text) return '';
        return text.replace(/\s+/g, ' ').trim();
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== 图片 URL 提取工具 ====================

    /**
     * 从 img 元素提取最佳 URL（优先 srcset 高清，fallback 到 src）
     * 支持 <picture><source srcset="..."><img></picture> 结构
     * 支持懒加载图片（data-src、data-lazy-src 等）
     */
    function getBestImageUrl(img) {
        console.log('[MemorySeek] getBestImageUrl: 开始提取图片 URL');

        // 0. 优先检查懒加载属性（图片未加载时，真实 URL 存储在这些属性中）
        const lazyAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-original-src'];
        for (const attr of lazyAttrs) {
            const lazySrc = img.getAttribute(attr);
            if (lazySrc && lazySrc.startsWith('http')) {
                console.log(`[MemorySeek]   ✓ 从 ${attr} 提取: ${lazySrc.substring(0, 80)}`);
                return lazySrc;
            }
        }

        // 1. 从 img 自身的 srcset 提取
        let srcset = img.getAttribute('srcset') || '';
        if (srcset && !srcset.startsWith('data:')) {
            console.log(`[MemorySeek]   img.srcset = ${srcset.substring(0, 100)}...`);
            const firstEntry = srcset.split(',')[0].trim().split(/\s+/)[0];
            if (firstEntry && firstEntry.startsWith('http')) {
                console.log(`[MemorySeek]   ✓ 从 img.srcset 提取: ${firstEntry.substring(0, 80)}`);
                return firstEntry;
            }
        }

        // 2. 检查父级 <picture> 中的 <source> 标签
        const picture = img.closest('picture');
        if (picture) {
            console.log('[MemorySeek]   检查父级 <picture> 标签');
            const sources = picture.querySelectorAll('source');
            for (const source of sources) {
                srcset = source.getAttribute('srcset') || '';
                if (srcset && !srcset.startsWith('data:')) {
                    console.log(`[MemorySeek]   source.srcset = ${srcset.substring(0, 100)}...`);
                    const firstEntry = srcset.split(',')[0].trim().split(/\s+/)[0];
                    if (firstEntry && firstEntry.startsWith('http')) {
                        console.log(`[MemorySeek]   ✓ 从 source.srcset 提取: ${firstEntry.substring(0, 80)}`);
                        return firstEntry;
                    }
                }
            }
        }

        // 3. fallback 到 img.src（可能是 base64 占位符或真实 URL）
        const src = img.src || img.getAttribute('src') || '';
        console.log(`[MemorySeek]   fallback 到 img.src: ${src.substring(0, 100)}...`);
        return src;
    }

    /**
     * 判断 URL 是否为有效的内容图片（排除图标、emoji 等）
     */
    function isContentImage(url) {
        if (!url || url.startsWith('data:')) return false;
        if (!url.startsWith('http')) return false;

        // 已知的图片 CDN 域名（豆包使用 byteimg.com）
        const knownImageHosts = ['byteimg.com', 'bytedance.com', 'bytecdn.cn'];
        try {
            const hostname = new URL(url).hostname;
            // 如果是已知图片 CDN，直接通过
            if (knownImageHosts.some(h => hostname.includes(h))) return true;
        } catch { /* URL 解析失败 */ }

        // 通用判断：URL 包含图片相关路径或扩展名
        if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)/i.test(url)) return true;
        if (/image|img|photo|pic|upload/i.test(url)) return true;

        // 其他 http 链接也放行（宁可多收集，后续过滤）
        return true;
    }


    /**
     * 触发容器内所有懒加载图片的加载
     * 返回 Promise，等待图片 URL 更新
     */
    async function triggerLazyLoadImages(container) {
        if (!container) return;

        const lazyImages = container.querySelectorAll('img[loading="lazy"]');
        if (lazyImages.length === 0) return;

        console.log(`[MemorySeek] 触发 ${lazyImages.length} 个懒加载图片...`);

        lazyImages.forEach(img => {
            const currentSrc = img.src || '';
            if (currentSrc.startsWith('data:')) {
                try {
                    img.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                } catch (e) { /* 忽略错误 */ }
            }
        });

        // 等待浏览器更新 src（通常很快，100-300ms）
        await sleep(500);
        console.log('[MemorySeek] 懒加载触发完成');
    }

    /**
     * 从一个 DOM 容器中收集所有有效图片 URL
     */
    function collectImagesFromElement(container) {
        const images = [];
        if (!container) {
            console.log('[MemorySeek] collectImagesFromElement: 容器为空');
            return images;
        }

        const imgElements = container.querySelectorAll('img');
        console.log(`[MemorySeek] 在容器中找到 ${imgElements.length} 个 img 标签`, container);

        imgElements.forEach((img, i) => {
            // 触发懒加载：如果是 loading="lazy" 且 src 是 base64，先滚动触发加载
            if (img.loading === 'lazy' || img.getAttribute('loading') === 'lazy') {
                const currentSrc = img.src || '';
                if (currentSrc.startsWith('data:')) {
                    console.log(`[MemorySeek]   img[${i}] 是懒加载且未加载，尝试触发加载...`);
                    try {
                        img.scrollIntoView({ behavior: 'instant', block: 'nearest' });
                        // 注意：这里是同步代码，图片可能还没来得及更新 src
                        // 但我们先尝试，看能否在后续的 getBestImageUrl 中获取到
                    } catch (e) {
                        console.log(`[MemorySeek]   scrollIntoView 失败:`, e);
                    }
                }
            }

            const url = getBestImageUrl(img);
            console.log(`[MemorySeek]   img[${i}]: ${url.substring(0, 80)}...`);
            if (isContentImage(url) && !images.includes(url)) {
                console.log(`[MemorySeek]   ✓ 已添加`);
                images.push(url);
            } else if (!isContentImage(url)) {
                console.log(`[MemorySeek]   ✗ 被过滤（不是内容图片）`);
            }
        });

        // 也检查 background-image（某些图片可能以背景方式展示）
        const bgElements = container.querySelectorAll('[style*="background-image"]');
        bgElements.forEach(el => {
            const style = el.getAttribute('style') || '';
            const match = style.match(/background-image:\s*url\(["']?(https?:\/\/[^"')]+)["']?\)/);
            if (match && isContentImage(match[1]) && !images.includes(match[1])) {
                images.push(match[1]);
            }
        });

        console.log(`[MemorySeek] 最终收集到 ${images.length} 张图片`);
        return images;
    }

    /**
     * 从 message_text_content 向上查找消息容器
     * 
     * 豆包中每条消息在 class="container-xxxxx" 的 div 中
     * （xxxxx 是 CSS Modules 哈希，会变化）
     */
    function findMessageContainer(el) {
        let node = el;
        console.log('[MemorySeek] findMessageContainer: 开始查找消息容器');

        for (let i = 0; i < 15 && node; i++) {
            const cls = node.className || '';
            if (typeof cls !== 'string') {
                node = node.parentElement;
                continue;
            }

            // 匹配 container- 前缀（如 container-PvPoAn）
            if (/\bcontainer-[a-zA-Z0-9_-]+\b/.test(cls)) {
                // 确保只包含 1 个 message_text_content（避免匹配到外层滚动容器）
                const msgCount = node.querySelectorAll('[data-testid="message_text_content"]').length;
                console.log(`[MemorySeek]   第${i}层: 找到 container- 类名，包含 ${msgCount} 个 message_text_content`);
                if (msgCount === 1) {
                    console.log('[MemorySeek]   ✓ 返回此容器:', node);
                    return node;
                }
            }

            node = node.parentElement;
        }

        console.log('[MemorySeek]   未找到合适容器，回退到父级');
        // 回退
        return el.parentElement?.parentElement || el;
    }

    // ==================== 对话列表提取 ====================

    function extractConversationList() {
        const conversations = [];
        const items = document.querySelectorAll('[id^="conversation_"]');

        items.forEach((item, index) => {
            const titleEl = item.querySelector('span');
            const title = cleanText(titleEl ? titleEl.textContent : '');

            if (title && title.length > 0 && title.length < 500) {
                conversations.push({
                    index: index,
                    title: title,
                    element: item,
                    id: item.id || `conv_${index}`,
                });
            }
        });

        return conversations;
    }

    // ==================== 消息提取 ====================

    /**
     * 等待容器内的所有懒加载图片加载完成
     * 只要发现 data: 开头的图片，就尝试滚动并等待，直到变为 http 或超时
     */
    async function ensureImagesLoaded(container) {
        if (!container) return;

        const images = container.querySelectorAll('img');
        const pendingImages = Array.from(images).filter(img => {
            const src = img.getAttribute('src') || '';
            const srcset = img.getAttribute('srcset') || '';
            // 如果 src 是 data: 且没有有效的 srcset/data-src，则视为未加载
            return src.startsWith('data:') && !srcset.startsWith('http') && !img.getAttribute('data-src');
        });

        if (pendingImages.length === 0) return;

        console.log(`[MemorySeek] 等待 ${pendingImages.length} 张懒加载图片...`);

        // 触发加载：滚动到视图中
        pendingImages.forEach(img => {
            try {
                img.scrollIntoView({ behavior: 'instant', block: 'nearest' });
            } catch (e) { }
        });

        // 轮询检查（最多 2 秒）
        for (let i = 0; i < 20; i++) {
            const stillPending = pendingImages.filter(img => {
                const src = img.src || img.getAttribute('src') || '';
                return src.startsWith('data:');
            });

            if (stillPending.length === 0) break;
            await sleep(100);
        }
        console.log('[MemorySeek] 图片加载等待结束');
    }

    async function extractCurrentMessages() {
        const messages = [];

        // 核心选择器：豆包的所有消息都有 data-testid="message_text_content"
        const msgElements = Array.from(document.querySelectorAll('[data-testid="message_text_content"]'));

        for (let idx = 0; idx < msgElements.length; idx++) {
            const el = msgElements[idx];
            console.log(`\n[MemorySeek] ===== 处理消息 #${idx} =====`);
            const role = detectRole(el);

            // 扩大搜索范围：在整个消息容器中查找图片
            const container = findMessageContainer(el);

            // 【新增】等待图片加载
            await ensureImagesLoaded(container);

            const { text } = extractMessageContent(el);
            const images = collectImagesFromElement(container);

            // 同时也收集 message_text_content 内部的图片（兜底）
            const innerImages = collectImagesFromElement(el);
            innerImages.forEach(url => {
                if (!images.includes(url)) images.push(url);
            });

            console.log(`[MemorySeek] 消息 #${idx} - 角色: ${role}, 文本长度: ${text?.length || 0}, 图片: ${images.length}`);
            if ((text && text.length > 0) || images.length > 0) {
                messages.push({
                    index: idx,
                    role: role,
                    content: text,
                    images: images,
                    timestamp: Date.now(),
                });
            }
        }

        return messages;
    }

    /**
     * 检测消息角色
     * 用户消息：某个祖先元素的 class 含 justify-end（右对齐）
     * AI 消息：自身或祖先含 data-message-id
     */
    function detectRole(el) {
        // 向上遍历最多 8 层祖先
        let node = el;
        for (let i = 0; i < 8 && node; i++) {
            const cls = node.className || '';

            // 用户消息标志：右对齐
            if (typeof cls === 'string' && (cls.includes('justify-end') || cls.includes('flex-row-reverse'))) {
                return 'user';
            }

            // AI 消息标志：有 data-message-id 或含 markdown 相关 class
            if (node.hasAttribute && node.hasAttribute('data-message-id')) {
                return 'assistant';
            }

            if (typeof cls === 'string' && (cls.includes('markdown-body') || cls.includes('flow-markdown'))) {
                return 'assistant';
            }

            node = node.parentElement;
        }

        // 检测自身是否含有 markdown 渲染内容（AI 回复通常有 markdown）
        if (el.querySelector('[class*="markdown"]') || el.querySelector('[class*="paragraph"]')) {
            return 'assistant';
        }

        // 检测文本长度：较长的通常是 AI 回复
        const text = (el.innerText || '').trim();
        if (text.length > 100) return 'assistant';

        return 'user';
    }

    /**
     * 提取消息文本内容
     * 图片以 ![image](url) 格式嵌入文本中
     */
    function extractMessageContent(el) {
        if (!el) return { text: '', images: [] };

        // 提取文本内容，将图片位置替换为 markdown 标记
        let text = '';
        const images = [];

        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();

                if (tag === 'img') {
                    const url = getBestImageUrl(node);
                    if (isContentImage(url)) {
                        text += `\n![图片](${url})\n`;
                        if (!images.includes(url)) images.push(url);
                    }
                } else if (tag === 'br') {
                    text += '\n';
                } else {
                    // 块级元素前后加换行
                    const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote'].includes(tag);
                    if (isBlock && text && !text.endsWith('\n')) text += '\n';

                    for (const child of node.childNodes) {
                        walk(child);
                    }

                    if (isBlock && text && !text.endsWith('\n')) text += '\n';
                }
            }
        };

        walk(el);
        text = text.trim();

        return { text, images };
    }

    // ==================== 完整扫描 ====================

    async function fullScan() {
        const conversations = extractConversationList();
        const currentMessages = await extractCurrentMessages();

        const result = {
            source: 'dom_extractor',
            pageTitle: document.title || '豆包对话',
            currentUrl: window.location.href,
            conversations: conversations.map(c => ({
                index: c.index,
                title: c.title,
                id: c.id,
            })),
            currentMessages: currentMessages,
            scannedAt: Date.now(),
        };

        chrome.runtime.sendMessage({
            action: 'DOM_DATA_EXTRACTED',
            payload: result
        }).catch(() => { });

        return result;
    }

    // ==================== 自动全量采集 ====================

    /**
     * 滚动加载所有对话列表
     */
    async function scrollConversationListToBottom() {
        console.log('[MemorySeek] 开始滚动加载对话列表...');

        // 尝试找到滚动容器：从第一个对话项向上查找
        let scrollContainer = null;
        const firstItem = document.querySelector('[id^="conversation_"]');
        if (firstItem) {
            let parent = firstItem.parentElement;
            while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
                    scrollContainer = parent;
                    break;
                }
                parent = parent.parentElement;
            }
        }

        if (!scrollContainer) {
            console.warn('[MemorySeek] 未找到对话列表的滚动容器，尝试备用方案');
        } else {
            console.log('[MemorySeek] 找到滚动容器:', scrollContainer);
        }

        let previousCount = 0;
        let noChangeCount = 0;
        const MAX_NO_CHANGE = 5; // 增加重试次数

        while (true) {
            const items = document.querySelectorAll('[id^="conversation_"]');
            const currentCount = items.length;
            console.log(`[MemorySeek] 当前列表项数量: ${currentCount}`);

            if (currentCount === 0) break;

            if (currentCount === previousCount) {
                noChangeCount++;
                if (noChangeCount >= MAX_NO_CHANGE) {
                    console.log('[MemorySeek] 列表不再增长，停止滚动');
                    break;
                }
            } else {
                noChangeCount = 0;
                // 通知进度（移掉 .catch 以避免语法错误）
                try {
                    chrome.runtime.sendMessage({
                        action: 'EXTRACT_STATUS',
                        payload: { status: 'started', total: currentCount, message: `正在加载列表... (${currentCount})` }
                    });
                } catch (e) { }
            }

            previousCount = currentCount;

            // 方案 A: 直接滚动容器 + 触发事件
            if (scrollContainer) {
                console.log(`[MemorySeek] 滚动容器: scrollTop=${scrollContainer.scrollTop}, scrollHeight=${scrollContainer.scrollHeight}`);

                // 1. 设置滚动位置
                scrollContainer.scrollTop = scrollContainer.scrollHeight;

                // 2. 主动触发 scroll 事件（React/Vue 等框架可能监听此事件）
                scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

                // 3. 模拟滚轮事件（某些懒加载库依赖）
                scrollContainer.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: 100,
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
            }

            // 方案 B: 滚动最后一个元素（双重保险）
            const lastItem = items[items.length - 1];
            if (lastItem) {
                try {
                    lastItem.scrollIntoView({ behavior: 'instant', block: 'end' });
                } catch (e) { }
            }

            // 方案 C: 尝试查找并点击“加载更多”按钮（如果存在）
            const loadMoreBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(el => el.innerText.includes('加载更多') || el.innerText.includes('Load More'));
            if (loadMoreBtn) {
                console.log('[MemorySeek] 发现加载更多按钮，尝试点击');
                loadMoreBtn.click();
            }

            await sleep(2000); // 增加等待时间
        }

        // 滚回顶部
        if (scrollContainer) {
            scrollContainer.scrollTop = 0;
        } else {
            const first = document.querySelector('[id^="conversation_"]');
            if (first) first.scrollIntoView({ behavior: 'instant', block: 'start' });
        }
        await sleep(1000);
    }

    async function autoExtractAll() {
        // 先尝试加载整个列表
        await scrollConversationListToBottom();

        const conversations = extractConversationList();

        if (conversations.length === 0) {
            chrome.runtime.sendMessage({
                action: 'EXTRACT_STATUS',
                payload: { status: 'error', message: '未找到对话列表，请确保页面已完全加载' }
            }).catch(() => { });
            return;
        }

        chrome.runtime.sendMessage({
            action: 'EXTRACT_STATUS',
            payload: { status: 'started', total: conversations.length }
        }).catch(() => { });

        const allData = [];

        for (let i = 0; i < conversations.length; i++) {
            const conv = conversations[i];

            chrome.runtime.sendMessage({
                action: 'EXTRACT_STATUS',
                payload: {
                    status: 'progress',
                    current: i + 1,
                    total: conversations.length,
                    title: conv.title,
                }
            }).catch(() => { });

            if (conv.element) {
                conv.element.click();
                await sleep(2000);
                // 等待消息渲染完成
                await waitForMessages();
            }

            const messages = await extractCurrentMessages();
            allData.push({
                conversationId: conv.id,
                title: conv.title,
                messages: messages,
                extractedAt: Date.now(),
            });
        }

        chrome.runtime.sendMessage({
            action: 'ALL_CONVERSATIONS_EXTRACTED',
            payload: {
                conversations: allData,
                totalConversations: allData.length,
                totalMessages: allData.reduce((sum, c) => sum + c.messages.length, 0),
                extractedAt: Date.now(),
            }
        }).catch(() => { });

        chrome.runtime.sendMessage({
            action: 'EXTRACT_STATUS',
            payload: { status: 'completed', total: allData.length }
        }).catch(() => { });
    }

    function waitForMessages(timeout = 5000) {
        return new Promise(resolve => {
            const start = Date.now();
            const check = () => {
                if (Date.now() - start > timeout) {
                    resolve();
                    return;
                }
                // 等待 message_text_content 出现
                const msgs = document.querySelectorAll('[data-testid="message_text_content"]');
                if (msgs.length > 0) {
                    setTimeout(resolve, 500);
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    }

    //==================== 消息监听 ====================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            switch (message.action) {
                case 'SCAN_PAGE': {
                    fullScan().then(result => {
                        sendResponse({ success: true, data: result });
                    });
                    return true; // 异步响应
                }
                case 'AUTO_EXTRACT_ALL':
                    autoExtractAll();
                    sendResponse({ success: true, message: '自动提取已启动' });
                    break;

                case 'EXTRACT_CURRENT': {
                    extractCurrentMessages().then(messages => {
                        sendResponse({ success: true, data: messages });
                    });
                    return true; // 异步响应
                }
                case 'PING':
                    sendResponse({ success: true, ready: true });
                    break;

                default:
                    sendResponse({ success: false, error: '未知操作' });
            }
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    });

    console.log('[MemorySeek] Content Script (extractor) 已就绪 ✓');
})();
