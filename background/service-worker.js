
// 引入 JSZip
importScripts('jszip.min.js');

/**
 * 导出为 ZIP 压缩包
 * 包含：chat_data.json 和 images/ 文件夹
 */
async function exportToZip(data) {
    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    const urlMap = new Map(); // originalUrl -> localPath

    // 辅助函数：下载图片并添加到 ZIP
    async function processImage(url) {
        if (!url) return url;
        if (urlMap.has(url)) return urlMap.get(url);

        let blob = null;
        let ext = '.png';

        try {
            if (url.startsWith('http')) {
                const resp = await fetch(url);
                if (!resp.ok) return url;
                blob = await resp.blob();
            } else if (url.startsWith('data:image/')) {
                const resp = await fetch(url);
                blob = await resp.blob();
            } else {
                return url;
            }

            // 确定扩展名
            if (blob.type === 'image/jpeg') ext = '.jpg';
            else if (blob.type === 'image/png') ext = '.png';
            else if (blob.type === 'image/gif') ext = '.gif';
            else if (blob.type === 'image/webp') ext = '.webp';
            else {
                // 尝试从 URL 获取
                const match = url.match(/\.(jpg|jpeg|png|gif|webp)/i);
                if (match) ext = match[0];
            }

            // 使用 UUID 作为文件名
            const uuid = self.crypto && self.crypto.randomUUID
                ? self.crypto.randomUUID()
                : `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            const filename = `${uuid}${ext}`;

            imgFolder.file(filename, blob);
            const localPath = `images/${filename}`;
            urlMap.set(url, localPath);
            return localPath;
        } catch (e) {
            console.warn('[MemorySeek] 图片处理失败:', url, e);
            // 失败时保留原链接（可能是 base64 或 http）
            return url;
        }
    }

    // 遍历所有对话，处理图片
    const conversations = data.conversations || [];
    for (const conv of conversations) {
        for (const msg of (conv.messages || [])) {
            // 处理 images 数组
            if (msg.images && msg.images.length > 0) {
                const newImages = [];
                for (const url of msg.images) {
                    const localPath = await processImage(url);
                    newImages.push(localPath);
                }
                msg.images = newImages;
            }

            // 处理 content 中的 Markdown 图片链接
            if (msg.content) {
                // 简单的字符串替换（可能会误伤，但在当前场景下可接受）
                // 更好的方式是正则替换，但 URL 均已在 urlMap 中
                for (const [url, localPath] of urlMap.entries()) {
                    if (msg.content.includes(url)) {
                        msg.content = msg.content.replaceAll(url, localPath);
                    }
                }
            }
        }
    }

    // 添加 JSON 文件
    zip.file("chat_data.json", JSON.stringify(data, null, 2));

    // 生成 ZIP
    const zipBlob = await zip.generateAsync({ type: "blob" });

    // 转为 Data URI (Service Worker 中无法使用 createObjectURL)
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(zipBlob);
    });
}

/**
 * 处理导出请求
 */
async function handleExportData(format) {
    const data = await getStoredData();
    if (!data.conversations || data.conversations.length === 0) {
        throw new Error('没有可导出的数据');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let filename = `doubao_chat_history_${timestamp}`;
    let content = '';

    if (format === 'json') {
        content = 'data:application/json;charset=utf-8,' + encodeURIComponent(exportToJSON(data));
        filename += '.json';
    } else if (format === 'md') {
        content = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(exportToMarkdown(data));
        filename += '.md';
    } else if (format === 'html') {
        const html = exportToHTML(data);
        content = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        filename += '.html';
    } else if (format === 'zip') {
        // ZIP 导出特殊处理
        content = await exportToZip(data); // 已经是 Data URI
        filename += '.zip';
    } else {
        throw new Error('不支持的导出格式');
    }

    // 下载文件
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: content,
            filename: `MemorySeek_Export/${filename}`, // 放入子目录
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve({ success: true, filename });
            }
        });
    });
}

function exportToJSON(data) {
    return JSON.stringify(data, null, 2);
}

function exportToMarkdown(data) {
    let md = '';
    const exportDate = new Date().toLocaleString('zh-CN');

    md += `# 豆包聊天记录导出\n\n`;
    md += `> 导出时间: ${exportDate}\n`;
    md += `> 对话数量: ${data.conversations ? data.conversations.length : 1}\n\n`;
    md += `---\n\n`;

    const conversations = data.conversations || [{ title: data.pageTitle || '对话', messages: data.currentMessages || [] }];

    conversations.forEach((conv, idx) => {
        md += `## ${idx + 1}. ${conv.title || '未命名对话'}\n\n`;

        if (conv.messages && conv.messages.length > 0) {
            conv.messages.forEach(msg => {
                const roleLabel = msg.role === 'user' ? '🧑 **我**' : '🤖 **豆包**';
                md += `### ${roleLabel}\n\n`;
                md += `${msg.content}\n\n`;
                // 追加图片
                if (msg.images && msg.images.length > 0) {
                    msg.images.forEach((url, i) => {
                        md += `![图片${i + 1}](${url})\n\n`;
                    });
                }
            });
        } else {
            md += `*（无消息记录）*\n\n`;
        }

        md += `---\n\n`;
    });

    return md;
}

function exportToHTML(data) {
    const exportDate = new Date().toLocaleString('zh-CN');
    const conversations = data.conversations || [{ title: data.pageTitle || '对话', messages: data.currentMessages || [] }];

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const conversationsHTML = conversations.map((conv, idx) => {
        const messagesHTML = (conv.messages || []).map(msg => {
            const isUser = msg.role === 'user';
            const escapedContent = escapeHtml(msg.content).replace(/\n/g, '<br>');
            let imagesHtml = '';
            if (msg.images && msg.images.length > 0) {
                imagesHtml = msg.images.map(url =>
                    `<div style="margin-top:8px"><img src="${escapeHtml(url)}" style="max-width:100%;border-radius:8px" loading="lazy"></div>`
                ).join('');
            }
            return `<div class="message ${isUser ? 'user' : 'assistant'}">
          <div class="role-badge">${isUser ? '我' : '豆包'}</div>
          <div class="bubble">${escapedContent}${imagesHtml}</div>
        </div>`;
        }).join('\n');

        return `<div class="conversation">
        <h2 class="conv-title">${idx + 1}. ${escapeHtml(conv.title || '未命名对话')}</h2>
        <div class="messages">${messagesHTML || '<p class="empty">（无消息记录）</p>'}</div>
      </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>豆包聊天记录 - ${exportDate}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#0f0f1a;color:#e0e0e0;line-height:1.6;padding:24px}
    .header{text-align:center;padding:32px 0;margin-bottom:32px;border-bottom:1px solid rgba(255,255,255,0.1)}
    .header h1{font-size:28px;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
    .header .meta{color:#888;font-size:14px}
    .conversation{max-width:800px;margin:0 auto 40px;background:rgba(255,255,255,0.03);border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,0.06)}
    .conv-title{font-size:18px;color:#a78bfa;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08)}
    .message{display:flex;gap:12px;margin-bottom:16px;align-items:flex-start}
    .message.user{flex-direction:row-reverse}
    .role-badge{flex-shrink:0;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600}
    .message.user .role-badge{background:linear-gradient(135deg,#667eea,#764ba2);color:white}
    .message.assistant .role-badge{background:linear-gradient(135deg,#10b981,#059669);color:white}
    .bubble{max-width:75%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.7;word-break:break-word}
    .message.user .bubble{background:linear-gradient(135deg,#667eea,#764ba2);color:white;border-bottom-right-radius:4px}
    .message.assistant .bubble{background:rgba(255,255,255,0.08);color:#e0e0e0;border-bottom-left-radius:4px}
    .empty{color:#666;text-align:center;padding:20px;font-style:italic}
  </style>
</head>
<body>
  <div class="header">
    <h1>📝 豆包聊天记录</h1>
    <div class="meta">导出时间: ${exportDate} | 共 ${conversations.length} 个对话</div>
  </div>
  ${conversationsHTML}
</body>
</html>`;
}

// ==================== 数据存储 ====================

const STORAGE_KEY = 'memorykeeper_data';

async function getStoredData() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {
        conversations: {},
        apiCaptures: [],
        stats: { totalConversations: 0, totalMessages: 0, lastUpdated: null }
    };
}

async function saveData(data) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

async function mergeConversationData(newConversations) {
    const stored = await getStoredData();

    for (const conv of newConversations) {
        const id = conv.conversationId || conv.id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        if (!stored.conversations[id] ||
            (conv.messages && conv.messages.length > (stored.conversations[id].messages || []).length)) {
            stored.conversations[id] = {
                id: id,
                title: conv.title || stored.conversations[id]?.title || '未命名对话',
                messages: conv.messages || [],
                updatedAt: Date.now(),
            };
        }
    }

    const convList = Object.values(stored.conversations);
    stored.stats = {
        totalConversations: convList.length,
        totalMessages: convList.reduce((sum, c) => sum + (c.messages?.length || 0), 0),
        lastUpdated: Date.now(),
    };

    await saveData(stored);
    return stored.stats;
}

async function storeApiCapture(capture) {
    const stored = await getStoredData();
    stored.apiCaptures.push({
        ...capture,
        storedAt: Date.now(),
    });
    if (stored.apiCaptures.length > 500) {
        stored.apiCaptures = stored.apiCaptures.slice(-500);
    }
    await saveData(stored);
}

// ==================== 图片下载 ====================

/**
 * 将图片 URL fetch 后转为 base64 data URI
 */
async function fetchImageAsBase64(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;

        const blob = await resp.blob();
        // 在 service worker 中用 FileReader 的替代方案
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const mimeType = blob.type || 'image/png';
        return `data:${mimeType};base64,${base64}`;
    } catch (e) {
        console.warn('[MemorySeek] 图片下载失败:', url, e);
        return null;
    }
}

/**
 * 下载所有对话中的图片，将 URL 替换为 base64
 */
async function downloadAllImages(conversations) {
    // 收集所有图片 URL（去重）
    const urlMap = new Map(); // url -> base64

    for (const conv of conversations) {
        for (const msg of (conv.messages || [])) {
            if (msg.images && msg.images.length > 0) {
                for (const url of msg.images) {
                    if (!urlMap.has(url)) {
                        urlMap.set(url, null); // 占位
                    }
                }
            }
        }
    }

    if (urlMap.size === 0) return;

    // 并发下载（最多 5 个同时）
    const urls = Array.from(urlMap.keys());
    const batchSize = 5;
    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(url => fetchImageAsBase64(url)));
        batch.forEach((url, idx) => {
            if (results[idx]) {
                urlMap.set(url, results[idx]);
            }
        });
    }

    // 替换消息中的图片 URL
    for (const conv of conversations) {
        for (const msg of (conv.messages || [])) {
            if (msg.images && msg.images.length > 0) {
                msg.images = msg.images.map(url => urlMap.get(url) || url);
            }
            // 同时替换 content 中的 ![图片](url)
            if (msg.content) {
                for (const [url, base64] of urlMap.entries()) {
                    if (base64 && msg.content.includes(url)) {
                        msg.content = msg.content.replaceAll(url, base64);
                    }
                }
            }
        }
    }
}

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(response => {
        sendResponse(response);
    }).catch(err => {
        sendResponse({ success: false, error: err.message });
    });
    return true;
});

async function handleMessage(message, sender) {
    switch (message.action) {
        case 'API_DATA_CAPTURED':
            await storeApiCapture(message.payload);
            return { success: true };

        case 'DOM_DATA_EXTRACTED': {
            const payload = message.payload;
            if (payload.currentMessages && payload.currentMessages.length > 0) {
                const stats = await mergeConversationData([{
                    id: extractConvIdFromUrl(payload.currentUrl),
                    title: payload.pageTitle,
                    messages: payload.currentMessages,
                }]);
                return { success: true, stats };
            }
            return { success: true };
        }

        case 'ALL_CONVERSATIONS_EXTRACTED': {
            const stats = await mergeConversationData(message.payload.conversations);
            return { success: true, stats };
        }

        case 'NEW_MESSAGES_DETECTED': {
            const msgs = message.payload.messages;
            if (msgs && msgs.length > 0) {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const url = tabs[0]?.url || '';
                const convId = extractConvIdFromUrl(url);
                await mergeConversationData([{
                    id: convId,
                    title: '对话',
                    messages: msgs,
                }]);
            }
            return { success: true };
        }

        case 'EXTRACT_STATUS':
            try {
                await chrome.runtime.sendMessage({
                    action: 'EXTRACT_STATUS_UPDATE',
                    payload: message.payload
                });
            } catch (e) { /* popup 可能未打开 */ }
            return { success: true };

        case 'GET_STATS': {
            const data = await getStoredData();
            return { success: true, stats: data.stats };
        }

        case 'GET_ALL_DATA': {
            const data = await getStoredData();
            return { success: true, data };
        }

        case 'EXPORT_DATA': {
            const format = message.format || 'json';
            const rawData = await getStoredData();

            const exportData = {
                exportedAt: new Date().toISOString(),
                conversations: Object.values(rawData.conversations),
                stats: rawData.stats,
            };

            let content, mimeType, extension;
            let isDataUrl = false;

            if (format === 'zip') {
                content = await exportToZip(exportData); // Returns Data URL
                mimeType = 'application/zip';
                extension = 'zip';
                isDataUrl = true;
            } else {
                // Non-ZIP formats: Embed images as Base64
                await downloadAllImages(exportData.conversations);

                switch (format) {
                    case 'markdown':
                        content = exportToMarkdown(exportData);
                        mimeType = 'text/markdown';
                        extension = 'md';
                        break;
                    case 'html':
                        content = exportToHTML(exportData);
                        mimeType = 'text/html';
                        extension = 'html';
                        break;
                    case 'json':
                    default:
                        content = exportToJSON(exportData);
                        mimeType = 'application/json';
                        extension = 'json';
                        break;
                }
            }

            const dateStr = new Date().toISOString().slice(0, 10);
            const filename = `doubao_chat_${dateStr}.${extension}`;

            const dataUrl = isDataUrl ? content : `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(content)))}`;

            await chrome.downloads.download({
                url: dataUrl,
                filename: `MemorySeek_Export/${filename}`,
                saveAs: true,
            });

            return { success: true, filename };
        }

        case 'CLEAR_DATA': {
            await chrome.storage.local.remove(STORAGE_KEY);
            return { success: true };
        }

        default:
            return { success: false, error: `未知操作: ${message.action}` };
    }
}

function extractConvIdFromUrl(url) {
    if (!url) return 'unknown';
    try {
        const u = new URL(url);
        const pathMatch = u.pathname.match(/\/chat\/([^\/]+)/);
        if (pathMatch) return pathMatch[1];
        const paramId = u.searchParams.get('conversation_id') || u.searchParams.get('id');
        if (paramId) return paramId;
        return u.pathname.replace(/\//g, '_') || 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

// ==================== 安装事件 ====================

chrome.runtime.onInstalled.addListener(() => {
    console.log('[MemorySeek] 插件已安装 ✓');
});

console.log('[MemorySeek] Background Service Worker 已启动 ✓');
