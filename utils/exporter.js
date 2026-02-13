/**
 * exporter.js - 导出工具模块
 * 支持将聊天数据导出为 JSON / Markdown / HTML 三种格式
 */

/**
 * 导出为 JSON 格式
 */
function exportToJSON(data) {
    return JSON.stringify(data, null, 2);
}

/**
 * 导出为 Markdown 格式
 */
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
            });
        } else {
            md += `*（无消息记录）*\n\n`;
        }

        md += `---\n\n`;
    });

    return md;
}

/**
 * 导出为 HTML 格式（独立可查看文件）
 */
function exportToHTML(data) {
    const exportDate = new Date().toLocaleString('zh-CN');
    const conversations = data.conversations || [{ title: data.pageTitle || '对话', messages: data.currentMessages || [] }];

    const conversationsHTML = conversations.map((conv, idx) => {
        const messagesHTML = (conv.messages || []).map(msg => {
            const isUser = msg.role === 'user';
            const escapedContent = escapeHtml(msg.content).replace(/\n/g, '<br>');
            return `
        <div class="message ${isUser ? 'user' : 'assistant'}">
          <div class="role-badge">${isUser ? '我' : '豆包'}</div>
          <div class="bubble">${escapedContent}</div>
        </div>`;
        }).join('\n');

        return `
      <div class="conversation">
        <h2 class="conv-title">${idx + 1}. ${escapeHtml(conv.title || '未命名对话')}</h2>
        <div class="messages">${messagesHTML || '<p class="empty">（无消息记录）</p>'}</div>
      </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>豆包聊天记录 - ${exportDate}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      line-height: 1.6;
      padding: 24px;
    }
    .header {
      text-align: center;
      padding: 32px 0;
      margin-bottom: 32px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .header h1 {
      font-size: 28px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .header .meta { color: #888; font-size: 14px; }
    .conversation {
      max-width: 800px;
      margin: 0 auto 40px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .conv-title {
      font-size: 18px;
      color: #a78bfa;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .message {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: flex-start;
    }
    .message.user { flex-direction: row-reverse; }
    .role-badge {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
    }
    .message.user .role-badge {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
    }
    .message.assistant .role-badge {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
    }
    .bubble {
      max-width: 75%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.7;
      word-break: break-word;
    }
    .message.user .bubble {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .message.assistant .bubble {
      background: rgba(255, 255, 255, 0.08);
      color: #e0e0e0;
      border-bottom-left-radius: 4px;
    }
    .empty { color: #666; text-align: center; padding: 20px; font-style: italic; }
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

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 导出供 service worker 使用
if (typeof globalThis !== 'undefined') {
    globalThis.MemoryKeeperExporter = { exportToJSON, exportToMarkdown, exportToHTML };
}
