# iFlow for Obsidian

> 将 iFlow CLI 嵌入 Obsidian，在你的笔记库中实现 AI 协作。完整的能力：文件读写、搜索、bash 命令和多步骤工作流。

![iFlow Logo](https://img.shields.io/badge/iFlow-Obsidian-blue)
![License](https://img.shields.io/github/license/junjie-yan/iflow-for-obsidian)
![Version](https://img.shields.io/github/v/release/junjie-yan/iflow-for-obsidian)

## ✨ 功能特性

### 🤖 完整的 AI 能力
- 利用 iFlow CLI 的强大功能，在 Obsidian 笔记库中读取、写入和编辑文件
- 支持多步骤工作流和复杂任务
- 完整的流式响应体验

### 📝 会话管理
- **历史记录保存**：所有会话自动保存，可随时切换
- **下拉面板**：点击按钮展开会话列表，点击外部自动关闭
- **Vault 隔离**：每个笔记库独立的会话存储
- **搜索过滤**：快速查找历史会话
- **导出功能**：支持导出为 JSON 或 Markdown 格式
- **导入功能**：从备份文件恢复会话

### 🎯 上下文感知
- 自动附加当前笔记内容
- 支持通过 `@` 引用其他文件
- 选中文本自动包含在上下文中
- 可配置排除标签（默认：`private`、`sensitive`）

### ⚙️ 模型与模式
- **10+ AI 模型**：GLM-4.7、GLM-5、DeepSeek-V3.2、Kimi-K2 等
- **4 种模式**：Normal（普通）、YOLO（激进）、Smart（智能）、Plan（计划）
- **思考模式**：可启用内部推理链

### 🛡️ 安全与性能
- 存储配额监控和自动清理
- 数据版本管理和迁移
- 优雅的错误处理和恢复
- 输入区域固定底部，消息区域独立滚动

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

### v0.6.3 (2026-03-09)

#### 🐛 Bug 修复
- 修复会话面板显示在页面底部的问题
- 面板现在正确显示在触发按钮正下方
- 作为下拉菜单展示，宽度自适应内容

#### 🔧 技术改进
- 添加 `position: relative` 到 `.iflow-conversation-selector`
- 调整面板宽度为自适应（`width: auto`）
- 面板最小宽度 300px，最大宽度 400px

### v0.6.2 (2026-03-09)

#### 🐛 Bug 修复
- 修复会话面板在页面加载时固定显示的问题
- 面板默认隐藏，只在点击触发按钮时显示
- 与 VSCode 版本行为保持一致

#### 🔧 技术细节
- 在创建会话面板时添加 `hidden` 类
- 面板初始状态为 `display: none`
- 点击触发按钮时切换 `aria-expanded` 和 `hidden` 类

### v0.6.1 (2026-03-09)

#### 🐛 Bug 修复
- 修复输入容器未固定在底部的问题
- 确保输入区域始终可见，不随消息滚动

#### 🔧 技术改进
- Flexbox 布局优化
- 完整的层级结构和定位
- 响应式设计

### v0.6.0 (2026-03-09)

#### 🎉 新功能
- ✨ 完整的会话历史管理系统
  - 支持会话创建、切换、删除
  - 自动保存所有消息
  - 会话搜索和过滤
  - 自动生成会话标题
- 💾 Vault 隔离存储
  - 每个笔记库独立的会话数据
  - 防止跨库数据污染
- 📤 导出功能
  - 导出为 JSON（完整数据备份）
  - 导出为 Markdown（人类可读）
- 📥 导入功能
  - 从 JSON 文件恢复会话
  - 智能合并策略避免重复
- 📊 存储配额管理
  - 自动监控存储使用情况
  - 超限时自动清理旧会话
  - 保留最近 50 个会话
- 📈 统计信息 API
  - 会话数量统计
  - 消息数量统计
  - 时间范围查询

#### 🐛 Bug 修复
- 修复 New Conversation 按钮无法切换面板的问题
- 修复会话数据溢出 localStorage 的问题
- 修复不同笔记库共享会话数据的问题
- 修复废弃的 `substr()` 方法警告

#### 🔧 技术改进
- 添加数据版本控制和自动迁移
- 使用 `substring()` 替代废弃的 `substr()`
- 改进面板状态管理机制
- 优化 pub/sub 模式实现

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

1. 确保已启动 iFlow CLI：`iflow`
2. 点击功能区图标或使用命令面板打开聊天
3. 像使用 Claude Code 一样与 iFlow 交互
4. 自动附加当前打开的笔记作为上下文

### 会话管理

#### 创建新会话
- 点击顶部的 `+` 按钮创建新会话
- 新会话会继承上一个会话的模型和模式设置

#### 切换会话
- 点击会话标题打开会话列表
- 选择要切换的会话
- 列表会显示今天的会话
- 点击面板外部或选择会话后自动关闭面板

#### 搜索会话
- 在会话列表中输入搜索关键词
- 实时过滤显示匹配的会话

#### 删除会话
- 在会话列表中点击 `×` 按钮删除
- 删除后自动切换到第一个可用会话

### 上下文功能

- **文件**：自动附加当前笔记；输入 `@` 附加其他文件
- **选中文本**：在编辑器中选中文字后聊天，选区会自动包含
- **排除标签**：带有排除标签（默认：`private`、`sensitive`）的笔记不会自动附加

### 模型和模式选择

#### 可用模型
- GLM-4.7
- GLM-5
- DeepSeek-V3.2
- Kimi-K2、Kimi-K2.5、Kimi-K2-Thinking
- MiniMax-M2.5、MiniMax-M2.1
- Qwen3-Coder-Plus
- iFlow-ROME-30BA3B（预览版）

#### 可用模式
- **Normal（普通）**：标准模式，平衡速度和质量
- **YOLO（激进）**：更快速但可能更冒险
- **Smart（智能）**：更深入的分析和推理
- **Plan（计划）**：系统化的规划和执行

#### 思考模式
- 启用后会显示 AI 的内部推理过程
- 适合理解 AI 的决策逻辑

### 快捷键

- `Ctrl/Cmd + Enter`：发送消息
- `Shift + Enter`：换行

## ⚙️ 配置

在 **设置 → iFlow** 中可以配置：

- **iFlow CLI WebSocket 端口**：iFlow CLI 监听的端口号（默认：8080）
- **连接超时**：连接 iFlow CLI 的超时时间（默认：5000ms）
- **启用自动滚动**：流式响应时自动滚动到底部（默认：开启）
- **排除标签**：自动排除这些标签的笔记，逗号分隔（默认：`private`、`sensitive`）

## 💾 数据存储

### 存储位置
- 每个笔记库的会话数据独立存储在浏览器 localStorage 中
- 存储键格式：`iflow-conversations-{vault_hash}`

### 存储限制
- **最大容量**：每个笔记库 4MB
- **自动清理**：超过限制时保留最近 50 个会话
- **警告阈值**：
  - 80%：接近限制
  - 95%：达到限制

### 导出和导入

#### 导出会话
目前可以通过 API 导出会话数据（未来将在 UI 中支持）：
- **JSON 格式**：包含完整的会话数据，用于备份
- **Markdown 格式**：人类可读的对话记录

#### 导入会话
支持从 JSON 文件导入会话：
- 自动合并策略，避免重复
- 保留现有会话数据

## 🏗️ 架构

```
src/
├── main.ts              # 插件入口
├── chatView.ts          # 聊天视图 UI
├── iflowService.ts      # iFlow CLI WebSocket 通信
├── conversationStore.ts # 会话存储管理
└── styles.css           # 样式
```

### 核心组件

| 组件 | 职责 |
|------|------|
| **IFlowPlugin** | 插件生命周期、设置管理 |
| **IFlowChatView** | 聊天界面、消息处理、会话切换 |
| **IFlowService** | WebSocket 通信、ACP 协议 |
| **ConversationStore** | 数据持久化、Vault 隔离、导入导出 |

## 🤝 贡献

欢迎贡献！请随时提交 [Issue](https://github.com/junjie-yan/iflow-for-obsidian/issues) 或 [Pull Request](https://github.com/junjie-yan/iflow-for-obsidian/pulls)。

### 开发指南

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'feat: add some AmazingFeature'`
4. 推送分支：`git push origin feature/AmazingFeature`
5. 提交 Pull Request

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `refactor:` 代码重构
- `test:` 测试相关
- `chore:` 构建/工具相关

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Obsidian](https://obsidian.md/) - 强大的知识管理工具
- [iFlow CLI](https://github.com/iflow-ai/iflow-cli) - 国产终端 AI 助手
- [iFlow for VSCode](https://github.com/iflow-ai/iflow-vscode) - VSCode 扩展，参考实现
- [Claudian](https://github.com/YishenTu/claudian) - Claude Code for Obsidian，本项目灵感来源

## 📮 联系方式

- GitHub: [@junjie-yan](https://github.com/junjie-yan)
- Issues: [GitHub Issues](https://github.com/junjie-yan/iflow-for-obsidian/issues)

## 🔗 相关项目

- [iFlow CLI](https://github.com/iflow-ai/iflow-cli) - 终端 AI 助手
- [iFlow for VSCode](https://github.com/iflow-ai/iflow-vscode) - VSCode 扩展
- [iFlow for JetBrains](https://github.com/iflow-ai/iflow-jetbrains) - JetBrains IDE 插件

---

Made with ❤️ by junjie-yan
