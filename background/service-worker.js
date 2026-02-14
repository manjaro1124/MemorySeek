/**
 * service-worker.js - Background Service Worker
 * 
 * 职责：
 * 1. 接收来自 Content Script 的数据
 * 2. 使用 chrome.storage.local 存储数据
 * 3. 处理导出请求 (统一导出为 ZIP)
 * 4. 管理插件状态
 */

// 引入 JSZip
importScripts('jszip.min.js');

// ==================== 导出格式生成函数 ====================

function generateJSON(data) {
    return JSON.stringify(data, null, 2);
}

function generateMarkdown(data) {
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
                // 追加图片 (此时 msg.content 里的图片链接和 msg.images 里的链接应该已经被替换为相对路径了)
                // 这里只额外显示存储在 images 数组但未在文中显示的图片（如果有的话）
                // 为简化逻辑，并在 Markdwon 中直观显示，我们假设 content 中的图片已经替换好。
                // 如果 msg.images 有图片但 content 没引用，可以追加显示：
                if (msg.images && msg.images.length > 0) {
                    // 简单去重：检查 content 是否已经包含了该图片路径
                    msg.images.forEach((url, i) => {
                        if (!msg.content || !msg.content.includes(url)) {
                            md += `![图片${i + 1}](${url})\n\n`;
                        }
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

function generateHTML(data) {
    const exportDate = new Date().toLocaleString('zh-CN');
    const conversations = data.conversations || [{ title: data.pageTitle || '对话', messages: data.currentMessages || [] }];

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const conversationsHTML = conversations.map((conv, idx) => {
        const messagesHTML = (conv.messages || []).map(msg => {
            const isUser = msg.role === 'user';
            // 此时 msg.content 中的图片路径已经是相对路径 "images/..."
            // 将 Markdown 图片语法 ![xxx](yyy) 转为 HTML img 标签
            // 简单处理：先转义 HTML，再把 Markdown 图片标记替换回来
            let contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br>');

            // 替换 Markdown 图片语法 ![alt](src) 为 <img src="src">
            // 注意：因为已转义，![ 变成了 ![  ] 变成了 ] (其实 [] 不会被转义除非特殊处理，escapeHtml 只转义 & < > ")
            // 这里的正则需要匹配未转义的 Markdown 链接结构
            contentHtml = contentHtml.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
                return `<br><img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0"><br>`;
            });

            // 处理 msg.images 中未在文中显示的图片
            let extraImagesHtml = '';
            if (msg.images && msg.images.length > 0) {
                msg.images.forEach(url => {
                    // 如果文中没包含该图片（简单判断）
                    if (!msg.content || !msg.content.includes(url)) {
                        extraImagesHtml += `<div style="margin-top:8px"><img src="${url}" style="max-width:100%;border-radius:8px" loading="lazy"></div>`;
                    }
                });
            }

            return `<div class="message ${isUser ? 'user' : 'assistant'}">
          <div class="role-badge">${isUser ? '我' : '豆包'}</div>
          <div class="bubble">${contentHtml}${extraImagesHtml}</div>
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
    .container{max-width:800px;margin:0 auto}
    .conversation{background:#1e1e2d;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 4px 12px rgba(0,0,0,0.2)}
    .conv-title{font-size:18px;margin-bottom:20px;color:#fff;border-bottom:1px solid #333;padding-bottom:12px}
    .message{display:flex;margin-bottom:20px;gap:12px}
    .message.user{flex-direction:row-reverse}
    .role-badge{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;flex-shrink:0}
    .message.user .role-badge{background:#4caf50;color:#fff}
    .message.assistant .role-badge{background:#2196f3;color:#fff}
    .bubble{background:#2b2b3c;padding:12px 16px;border-radius:12px;max-width:80%;word-wrap:break-word}
    .message.user .bubble{background:#2e3b4e}
    img{max-width:100%;height:auto;display:block}
    .empty{text-align:center;color:#666;font-style:italic}
  </style>
</head>
<body>
  <div class="container">
    ${conversationsHTML}
  </div>
</body>
</html>`;
}

// ==================== 核心导出逻辑 ====================

/**
 * 统一 ZIP 导出函数
 * @param {Object} data 原始数据
 * @param {string} format 'json' | 'md' | 'html' | 'zip' (全部)
 */
async function exportToZip(data, format) {
    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    const urlMap = new Map(); // originalUrl -> localPath

    // 1. 深度拷贝数据，以免修改原始存储
    const processedData = JSON.parse(JSON.stringify(data));
    const conversations = processedData.conversations || [];

    // 2. 扫描所有图片，下载并建立映射
    // 辅助函数：下载图片并添加到 ZIP
    async function downloadAndMapImage(url) {
        if (!url || !url.startsWith('http')) return url; // 忽略 base64 或无效 url
        if (urlMap.has(url)) return urlMap.get(url);

        try {
            const resp = await fetch(url);
            if (!resp.ok) return url;

            const blob = await resp.blob();
            // 获取扩展名，默认为 .png
            let ext = '.png';
            const mime = blob.type;
            if (mime === 'image/jpeg') ext = '.jpg';
            else if (mime === 'image/gif') ext = '.gif';
            else if (mime === 'image/webp') ext = '.webp';
            else {
                // 尝试从 URL 获取
                const match = url.match(/\.(jpg|jpeg|png|gif|webp)/i);
                if (match) ext = match[0];
            }

            // 生成随机文件名确保唯一
            const filename = `img_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}${ext}`;

            imgFolder.file(filename, blob);
            const localPath = `images/${filename}`; // 相对路径
            urlMap.set(url, localPath);
            return localPath;
        } catch (e) {
            console.warn('[MemorySeek] Image download failed:', url, e);
            return url;
        }
    }

    // 收集所有需要下载的 URL
    const allUrls = new Set();
    for (const conv of conversations) {
        if (conv.messages) {
            for (const msg of conv.messages) {
                if (msg.images && msg.images.length > 0) {
                    msg.images.forEach(u => allUrls.add(u));
                }
            }
        }
    }

    // 并发下载 (限制并发数防止网络堵塞，这里简单起见直接 Promise.all，量大时可能需控制)
    // 实际上浏览器对同域有并发限制，这里是由 Service Worker 发起 fetch
    const urlList = Array.from(allUrls);
    console.log(`[MemorySeek] 开始下载 ${urlList.length} 张图片...`);

    // 简单分批处理，每次 5 张
    for (let i = 0; i < urlList.length; i += 5) {
        const batch = urlList.slice(i, i + 5);
        await Promise.all(batch.map(u => downloadAndMapImage(u)));
    }

    // 3. 替换 processedData 中的图片链接为本地相对路径
    for (const conv of conversations) {
        if (conv.messages) {
            for (const msg of conv.messages) {
                // 替换 images 数组
                if (msg.images && msg.images.length > 0) {
                    msg.images = msg.images.map(url => urlMap.get(url) || url);
                }
                // 替换 content 中的 Markdown 链接
                if (msg.content) {
                    // 遍历 map 进行替换。
                    // 注意：这可能效率较低，更好的是用正则匹配 content 里的 url
                    // 但考虑到已知的 url 都在 urlMap 里，直接替换也是可行的
                    // 为避免替换部分重叠的 URL，我们... 其实 URL 通常较长且唯一
                    urlMap.forEach((localPath, originalUrl) => {
                        if (msg.content.includes(originalUrl)) {
                            msg.content = msg.content.split(originalUrl).join(localPath);
                        }
                    });
                }
            }
        }
    }

    // 4. 根据 format 生成文件放入 ZIP
    if (format === 'json' || format === 'zip') {
        zip.file("chat_data.json", generateJSON(processedData));
    }
    if (format === 'md' || format === 'zip') {
        zip.file("chat_history.md", generateMarkdown(processedData));
    }
    if (format === 'html' || format === 'zip') {
        zip.file("chat_history.html", generateHTML(processedData));
    }

    // 5. 生成 ZIP Blob
    const content = await zip.generateAsync({ type: "blob" });

    // 转 Data URI 以便下载
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(content);
    });
}


/**
 * 处理主导出入口
 */
async function handleExportData(format) {
    const data = await getStoredData();
    if (!data.conversations || data.conversations.length === 0) {
        throw new Error('没有可导出的数据');
    }

    // 无论用户选什么格式，都走 exportToZip，只是内容不同
    const zipDataURI = await exportToZip(data, format); // format: json/md/html/zip

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // 文件名包含格式标识，但后缀总是 .zip
    const filename = `MemorySeek_${format.toUpperCase()}_${timestamp}.zip`;

    // 下载
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: zipDataURI,
            filename: `MemorySeek_Export/${filename}`, // 下载到 MemorySeek_Export 文件夹下
            saveAs: false // 不弹窗，直接下
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve({ success: true, filename });
            }
        });
    });
}


// ==================== 数据存储 ====================

const STORAGE_KEY = 'memorykeeper_data';

function getStoredData() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            resolve(result[STORAGE_KEY] || {});
        });
    });
}

function saveData(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
            resolve();
        });
    });
}

/**
 * 增量合并对话数据
 */
async function mergeConversationData(newConversations) {
    const data = await getStoredData();
    const existingConvs = data.conversations || [];

    let addedCount = 0;
    let updatedCount = 0;

    for (const newConv of newConversations) {
        // 尝试通过 title 匹配 (豆包没 ID，暂时用 Title)
        // 改进：如果正好是当前正在浏览的，可能 title 变了？暂且只用 title 匹配
        const index = existingConvs.findIndex(c => c.title === newConv.title);

        if (index !== -1) {
            // 更新：合并消息
            const existConv = existingConvs[index];
            // 简单的去重合并：根据消息内容和角色
            const mergedMsgs = [...existConv.messages];

            newConv.messages.forEach(newMsg => {
                const isExist = mergedMsgs.some(m =>
                    m.content === newMsg.content && m.role === newMsg.role
                );
                if (!isExist) {
                    mergedMsgs.push(newMsg);
                }
            });

            // 按 timestamp 排序
            mergedMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            existingConvs[index].messages = mergedMsgs;
            updatedCount++;
        } else {
            // 新增
            existingConvs.push(newConv);
            addedCount++;
        }
    }

    data.conversations = existingConvs;
    data.lastUpdated = Date.now();

    // 更新总计数据
    data.stats = {
        totalConversations: existingConvs.length,
        totalMessages: existingConvs.reduce((sum, c) => sum + (c.messages?.length || 0), 0),
        lastUpdated: data.lastUpdated
    };

    await saveData(data);
    return { added: addedCount, updated: updatedCount, total: existingConvs.length };
}


// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 异步处理需要返回 true
    handleMessage(message, sender)
        .then(response => sendResponse(response))
        .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
});

async function handleMessage(message, sender) {
    switch (message.action) {
        case 'SAVE_CHAT_DATA':
            // 保存 content script 提取的数据
            const stats = await mergeConversationData(message.data);
            return { success: true, stats };

        case 'GET_STATS':
            const data = await getStoredData();
            return { success: true, stats: data.stats || {} };

        case 'EXPORT_DATA':
            // 导出数据
            return await handleExportData(message.format);

        case 'CLEAR_DATA':
            await saveData({});
            return { success: true };

        default:
            // 其它消息忽略或由 popup 处理
            return { success: false, error: 'Unknown action' };
    }
}


// ==================== 安装事件 ====================

chrome.runtime.onInstalled.addListener(() => {
    console.log('[MemorySeek] 插件已安装 ✓');
});

console.log('[MemorySeek] Background Service Worker 已启动 ✓');
