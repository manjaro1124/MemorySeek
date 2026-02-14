# MemorySeek 🧠

> 豆包聊天记录导出 Chrome 浏览器插件

从 [豆包 (doubao.com)](https://www.doubao.com) 网页版提取并导出所有聊天历史记录，支持 **JSON / Markdown / HTML / ZIP** 三种格式。

## ✨ 功能特性

- **网络请求拦截** — 自动捕获豆包 API 响应中的聊天数据（最可靠的方式）
- **DOM 解析提取** — 直接从页面 DOM 中提取当前可见的聊天内容
- **全量采集** — 一键自动遍历所有历史对话，逐个提取消息
- **实时监控** — 使用 MutationObserver 实时捕获新消息
- **多格式导出** — 统一导出为 **ZIP 压缩包**，内含 JSON/Markdown/HTML 数据文件及**所有图片资源**（本地化存储）
- **数据持久化** — 采集的数据保存在浏览器本地存储中

## 🚀 安装方法

1. 克隆或下载此项目
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角的"**开发者模式**"
4. 点击"**加载已解压的扩展程序**"
5. 选择本项目的根目录（`memoryseek` 文件夹）
6. 插件图标将出现在浏览器工具栏中

## 📖 使用方法

### 基本操作

1. 在浏览器中打开 [豆包](https://www.doubao.com/chat/)
2. 点击浏览器工具栏中的 MemorySeek 图标
3. 确认状态显示"**已连接豆包页面**"

### 采集数据

- **扫描当前页** — 提取当前正在浏览的对话内容
- **全量采集** — 自动遍历左侧所有对话，逐个提取（耗时较长，过程中请勿操作页面）

### 导出数据

点击导出区域的按钮，所有格式均会生成 **ZIP 压缩包**，解压后包含 `images` 文件夹（存放图片）和对应的数据文件。

| 按钮 | 包含内容 | 适用场景 |
|------|----------|----------|
| **JSON** | `chat_data.json` + 图片 | 程序处理、数据分析 |
| **Markdown** | `chat_history.md` + 图片 | 笔记软件导入（Notion/Obsidian 等） |
| **HTML** | `chat_history.html` + 图片 | 直接在浏览器中查看，分享 |
| **全部格式** | JSON + MD + HTML + 图片 | 完整备份（推荐） |

## 🏗️ 项目结构

```
memoryseek/
├── manifest.json              # Chrome 扩展配置
├── popup/                     # 弹窗 UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                   # Content Scripts
│   ├── interceptor.js         # 网络请求拦截桥梁
│   ├── injected.js            # 注入页面的拦截脚本
│   └── extractor.js           # DOM 解析提取器
├── background/
│   └── service-worker.js      # 后台服务
├── utils/
│   └── exporter.js            # 导出工具
└── icons/                     # 插件图标
```

## ⚠️ 注意事项

- 插件仅在 `doubao.com` 域名下生效
- 首次使用前请**刷新豆包页面**，确保 Content Script 注入成功
- 全量采集时请勿操作页面，以免中断提取过程
- 豆包 DOM 结构可能随版本更新变化，如发现提取异常请提交 Issue
- 所有数据仅存储在浏览器本地，不会上传到任何服务器

## 📄 License

MIT
