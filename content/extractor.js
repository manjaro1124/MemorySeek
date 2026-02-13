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

    function extractCurrentMessages() {
        const messages = [];

        // 核心选择器：豆包的所有消息都有 data-testid="message_text_content"
        const msgElements = document.querySelectorAll('[data-testid="message_text_content"]');

        msgElements.forEach((el, idx) => {
            const role = detectRole(el);
            const { text, images } = extractMessageContent(el);

            if ((text && text.length > 0) || images.length > 0) {
                messages.push({
                    index: idx,
                    role: role,
                    content: text,
                    images: images, // 图片 URL 列表
                    timestamp: Date.now(),
                });
            }
        });

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
     * 提取消息内容（文本 + 图片）
     * 图片以 ![image](url) 格式嵌入文本中
     */
    function extractMessageContent(el) {
        if (!el) return { text: '', images: [] };

        const images = [];

        // 收集所有图片 URL
        const imgElements = el.querySelectorAll('img');
        imgElements.forEach(img => {
            const src = img.src || img.getAttribute('src') || '';
            // 跳过 base64 图标、emoji 等小图
            if (src && !src.startsWith('data:') && src.startsWith('http')) {
                images.push(src);
            }
        });

        // 提取文本内容，将图片位置替换为 markdown 标记
        let text = '';
        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();

                if (tag === 'img') {
                    const src = node.src || '';
                    if (src && !src.startsWith('data:') && src.startsWith('http')) {
                        text += `\n![图片](${src})\n`;
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

    function fullScan() {
        const conversations = extractConversationList();
        const currentMessages = extractCurrentMessages();

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

    async function autoExtractAll() {
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

            const messages = extractCurrentMessages();
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

    // ==================== 消息监听 ====================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            switch (message.action) {
                case 'SCAN_PAGE': {
                    const result = fullScan();
                    sendResponse({ success: true, data: result });
                    break;
                }
                case 'AUTO_EXTRACT_ALL':
                    autoExtractAll();
                    sendResponse({ success: true, message: '自动提取已启动' });
                    break;

                case 'EXTRACT_CURRENT': {
                    const messages = extractCurrentMessages();
                    sendResponse({ success: true, data: messages });
                    break;
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
