# iFlow for Obsidian

> 将 iFlow CLI 嵌入 Obsidian，在你的笔记库中实现 AI 协作。完整的能力：文件读写、搜索、bash 命令和多步骤工作流。

![iFlow Logo](https://img.shields.io/badge/iFlow-Obsidian-blue)
![License](https://img.shields.io/github/license/junjie-yan/iflow-for-obsidian)
![Version](https://img.shields.io/github/v/release/junjie-yan/iflow-for-obsidian)

## ✨ 功能特性

- **🤖 完整的 AI 能力**：利用 iFlow CLI 的强大功能，在 Obsidian 笔记库中读取、写入和编辑文件
- **📝 上下文感知**：自动附加当前笔记，支持通过 `@` 引用文件
- **🖼️ 视觉支持**：分析图片和视觉内容
- **⚡ 内联编辑**：直接在笔记中编辑选中文本
- **🔧 斜杠命令**：创建可重用的提示词模板
- **🔌 MCP 支持**：通过模型上下文协议连接外部工具和数据源
- **🛡️ 安全模式**：权限模式和沙箱执行

## 📋 要求

- **Obsidian** v1.8.9 或更高版本
- **iFlow CLI** 已安装并运行
  - 启动：`iflow`（默认监听端口 8080）
- **仅桌面端**：macOS、Linux、Windows

## 📚 文档

- [开发文档](DEVELOPMENT.md) - 详细的开发指南和架构说明
- [快速参考](CHEATSHEET.md) - 常用命令和代码片段速查
- [智能体系统](AGENTS.md) - Agent 定义和使用指南
- [AI 理解文档](CLAUDE.md) - 给 Claude AI 阅读的项目文档

## 🔄 更新日志

### v0.5.3 (2026-03-06)
- 改进自动滚动到底部的功能
- 使用 requestAnimationFrame 实现更平滑的滚动
- 添加 double-check 机制处理异步 DOM 更新

### v0.5.2 (2026-03-06)
- 修复流式传输完成后 onEnd 回调未触发的问题
- 修复 isStreaming 状态未正确重置导致的消息丢失问题
- 添加流式传输期间防止重复加载消息的保护机制

## 🚀 安装

### 方式一：通过 BRAT 插件安装（推荐，更简单）

1. 在 Obsidian 中安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件
2. 打开 BRAT 设置：**设置 → 社区插件 → BRAT**
3. 点击 **"Add Beta plugin"** 按钮
4. 输入仓库地址：`https://github.com/junjie-yan/iflow-for-obsidian`
5. 点击 **"Add Plugin"**，BRAT 将自动安装插件
6. 在 **设置 → 社区插件** 中启用 **"iFlow for Obsidian"**

> 💡 BRAT 会自动检查更新并通知你有新版本可用

### 方式二：手动安装

1. 从 [Releases](https://github.com/junjie-yan/iflow-for-obsidian/releases) 下载最新版本
2. 将 `main.js`、`manifest.json` 和 `styles.css` 复制到你的 vault 的插件文件夹：
   ```
   /path/to/vault/.obsidian/plugins/iflow-for-obsidian/
   ```
3. 在 Obsidian 设置中启用插件：
   - **设置 → 社区插件 → 启用 "iFlow for Obsidian"**

### 方式三：从源码构建（开发）

```bash
# 克隆仓库
git clone https://github.com/junjie-yan/iflow-for-obsidian.git
cd iflow-for-obsidian

# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```

## 📖 使用方法

### 基本使用

1. 点击功能区图标或使用命令面板打开聊天
2. 像使用 Claude Code 一样与 iFlow 交互
3. 自动附加当前打开的笔记作为上下文

### 上下文功能

- **文件**：自动附加当前笔记；输入 `@` 附加其他文件
- **选中文本**：在编辑器中选中文字后聊天，选区会自动包含
- **排除标签**：带有排除标签（默认：`private`、`sensitive`）的笔记不会自动附加

### 快捷键

- `Ctrl/Cmd + Enter`：发送消息
- `Shift + Enter`：换行

## ⚙️ 配置

在 **设置 → iFlow** 中可以配置：

- **iFlow CLI WebSocket 端口**：iFlow CLI 监听的端口号（默认：8090）
- **连接超时**：连接 iFlow CLI 的超时时间（默认：60000ms）
- **启用自动滚动**：流式响应时自动滚动到底部
- **排除标签**：自动排除这些标签的笔记（逗号分隔）

## 🏗️ 架构

```
src/
├── main.ts              # 插件入口
├── iflowService.ts      # iFlow CLI WebSocket 通信
├── chatView.ts          # 聊天视图 UI
└── styles.css           # 样式
```

## 🤝 贡献

欢迎贡献！请随时提交 [Issue](https://github.com/junjie-yan/iflow-for-obsidian/issues) 或 [Pull Request](https://github.com/junjie-yan/iflow-for-obsidian/pulls)。

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Obsidian](https://obsidian.md/) - 强大的知识管理工具
- [iFlow CLI](https://github.com/iflow-ai/iflow-cli) - 国产终端 AI 助手
- [Claudian](https://github.com/YishenTu/claudian) - Claude Code for Obsidian，本项目灵感来源

## 📮 联系方式

- GitHub: [@junjie-yan](https://github.com/junjie-yan)
- Issues: [GitHub Issues](https://github.com/junjie-yan/iflow-for-obsidian/issues)

---

Made with ❤️ by junjie-yan
