/**
 * popup.js - Popup 弹窗逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
    // DOM 元素
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const convCount = document.getElementById('convCount');
    const msgCount = document.getElementById('msgCount');
    const lastUpdate = document.getElementById('lastUpdate');
    const progressSection = document.getElementById('progressSection');
    const progressText = document.getElementById('progressText');
    const progressPercent = document.getElementById('progressPercent');
    const progressFill = document.getElementById('progressFill');
    const btnScanPage = document.getElementById('btnScanPage');
    const btnAutoExtract = document.getElementById('btnAutoExtract');
    const btnClearData = document.getElementById('btnClearData');

    // ==================== 初始化 ====================

    await checkPageStatus();
    await refreshStats();

    // ==================== 检查页面状态 ====================

    async function checkPageStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url || !tab.url.includes('doubao.com')) {
                setStatus('inactive', '请在豆包页面上使用');
                btnScanPage.disabled = true;
                btnAutoExtract.disabled = true;
                return;
            }

            // Ping content script
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'PING' });
                if (response && response.success) {
                    setStatus('active', '已连接豆包页面');
                }
            } catch {
                setStatus('inactive', '请刷新豆包页面后重试');
                btnScanPage.disabled = true;
                btnAutoExtract.disabled = true;
            }
        } catch {
            setStatus('inactive', '无法检测页面');
            btnScanPage.disabled = true;
            btnAutoExtract.disabled = true;
        }
    }

    function setStatus(type, text) {
        statusDot.className = 'dot ' + type;
        statusText.textContent = text;
    }

    // ==================== 刷新统计 ====================

    async function refreshStats() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
            if (response && response.success) {
                const stats = response.stats;
                convCount.textContent = stats.totalConversations || 0;
                msgCount.textContent = stats.totalMessages || 0;
                if (stats.lastUpdated) {
                    const d = new Date(stats.lastUpdated);
                    lastUpdate.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                } else {
                    lastUpdate.textContent = '-';
                }
            }
        } catch { }
    }

    // ==================== 扫描当前页 ====================

    btnScanPage.addEventListener('click', async () => {
        try {
            btnScanPage.disabled = true;
            setStatus('working', '正在扫描...');

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_PAGE' });

            if (response && response.success) {
                const data = response.data;
                const msgNum = data.currentMessages?.length || 0;

                // 构造对话数据并保存
                if (msgNum > 0) {
                    const convData = {
                        title: data.pageTitle || '当前对话',
                        messages: data.currentMessages,
                        timestamp: Date.now()
                    };

                    // 发送给 background 保存
                    await chrome.runtime.sendMessage({
                        action: 'SAVE_CHAT_DATA',
                        data: [convData]
                    });

                    showToast(`扫描保存完成: ${msgNum} 条消息`);
                    // 刷新统计
                    await refreshStats();
                } else {
                    showToast('未发现消息');
                }

                setStatus('active', '扫描完成');
            } else {
                showToast('扫描失败', true);
                setStatus('active', '已连接');
            }
        } catch (err) {
            showToast('扫描出错: ' + err.message, true);
            setStatus('inactive', '连接中断');
        } finally {
            btnScanPage.disabled = false;
            await refreshStats();
        }
    });

    // ==================== 全量采集 ====================

    btnAutoExtract.addEventListener('click', async () => {
        if (!confirm('将自动遍历所有对话并提取聊天记录，过程中请勿操作页面。\n\n确定开始？')) return;

        try {
            btnAutoExtract.disabled = true;
            btnScanPage.disabled = true;
            setStatus('working', '全量采集中...');
            showProgress(true);

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { action: 'AUTO_EXTRACT_ALL' });
        } catch (err) {
            showToast('采集启动失败: ' + err.message, true);
            setStatus('active', '已连接');
            btnAutoExtract.disabled = false;
            btnScanPage.disabled = false;
            showProgress(false);
        }
    });

    // ==================== 监听采集状态更新 ====================

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action !== 'EXTRACT_STATUS_UPDATE') return;

        const payload = message.payload;

        switch (payload.status) {
            case 'started':
                updateProgress(0, payload.total, '正在准备...');
                break;

            case 'progress':
                updateProgress(payload.current, payload.total, `正在提取: ${payload.title}`);
                break;

            case 'completed':
                showProgress(false);
                setStatus('active', `采集完成: ${payload.total} 个对话`);
                showToast(`全量采集完成: ${payload.total} 个对话`);
                btnAutoExtract.disabled = false;
                btnScanPage.disabled = false;
                refreshStats();
                break;

            case 'error':
                showProgress(false);
                setStatus('active', '采集出错');
                showToast(payload.message, true);
                btnAutoExtract.disabled = false;
                btnScanPage.disabled = false;
                break;
        }
    });

    // ==================== 导出 ====================

    document.querySelectorAll('.btn-export').forEach(btn => {
        btn.addEventListener('click', async () => {
            const format = btn.dataset.format;
            try {
                btn.disabled = true;
                const response = await chrome.runtime.sendMessage({
                    action: 'EXPORT_DATA',
                    format: format
                });

                if (response && response.success) {
                    showToast(`已导出: ${response.filename}`);
                } else {
                    showToast('导出失败: ' + (response?.error || '未知错误'), true);
                }
            } catch (err) {
                showToast('导出出错: ' + err.message, true);
            } finally {
                btn.disabled = false;
            }
        });
    });

    // ==================== 清除数据 ====================

    btnClearData.addEventListener('click', async () => {
        if (!confirm('确定清除所有已采集的数据？此操作不可恢复。')) return;

        try {
            await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
            showToast('数据已清除');
            await refreshStats();
        } catch (err) {
            showToast('清除失败: ' + err.message, true);
        }
    });

    // ==================== UI 工具 ====================

    function showProgress(visible) {
        progressSection.style.display = visible ? 'block' : 'none';
    }

    function updateProgress(current, total, text) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        progressText.textContent = text || '';
        progressPercent.textContent = `${percent}%`;
        progressFill.style.width = `${percent}%`;
    }

    function showToast(msg, isError = false) {
        // 移除旧 toast
        const old = document.querySelector('.toast');
        if (old) old.remove();

        const toast = document.createElement('div');
        toast.className = `toast${isError ? ' error' : ''}`;
        toast.textContent = msg;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }
});
