# Agents - iFlow 智能体系统

## 概述

iFlow CLI 支持自定义智能体（Agents），可以让你创建专门的 AI 助手来处理特定任务。每个 Agent 可以：
- 使用不同的模型
- 限制可用的工具
- 有特定的系统提示词
- 专注于特定领域

## Agent 定义

Agent 通过 Markdown 文件定义，支持 YAML 前置元数据：

### 基本格式

```markdown
---
name: "Code Reviewer"
description: "专业的代码审查助手"
model: "glm-4.7"
tools:
  - read_text_file
  - search_files
  - bash
system_prompt: |
  你是一个专业的代码审查助手。你的任务是：
  1. 检查代码质量和潜在问题
  2. 提供改进建议
  3. 确保代码符合最佳实践
---

# Code Reviewer Agent

这是一个专门用于代码审查的智能体。它会仔细检查你的代码，提供详细的反馈和改进建议。
```

### 完整示例

```markdown
---
name: "Documentation Writer"
description: "自动生成和维护项目文档"
model: "qwen3-coder-plus"
mode: "coding"
thinking_enabled: true
allowed_tools:
  - read_text_file
  - write_text_file
  - search_files
blocked_tools:
  - bash
  - delete_file
environment:
  DOC_STYLE: "markdown"
  INCLUDE_EXAMPLES: "true"
system_prompt: |
  你是一个专业的文档编写助手。

  ## 任务
  - 为代码生成清晰的文档
  - 编写 API 文档和使用示例
  - 维护 README 和开发文档

  ## 风格指南
  - 使用简洁明了的语言
  - 提供实际代码示例
  - 包含使用场景说明
  - 保持与项目风格一致

  ## 输出格式
  - Markdown 格式
  - 包含目录结构
  - 使用代码高亮
---

# Documentation Writer

专门用于编写和维护项目文档的智能体。
```

## 配置字段说明

### 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Agent 显示名称 |
| `description` | string | Agent 功能描述 |
| `system_prompt` | string | 系统提示词 |

### 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | string | `glm-4.7` | 使用的模型 |
| `mode` | string | `default` | 运行模式（default/coding） |
| `thinking_enabled` | boolean | `false` | 是否启用思考模式 |
| `allowed_tools` | array[] | `null` | 允许的工具列表（null=全部允许） |
| `blocked_tools` | array[] | `[]` | 禁止使用的工具 |
| `environment` | object | `{}` | 环境变量 |
| `max_turns` | number | `10` | 最大对话轮次 |

## 工具列表

### iFlow CLI 可用工具

```yaml
# 文件操作
- read_text_file        # 读取文本文件
- write_text_file       # 写入文本文件
- delete_file           # 删除文件
- search_files          # 搜索文件
- list_directory        # 列出目录

- Bash 命令
- bash                  # 执行 bash 命令
- command_complete      # 命令自动完成

# 编辑器操作
- edit_file             # 编辑文件
- apply_diff            # 应用 diff

# 上下文操作
- context_gather        # 收集上下文
- grep_search           # grep 搜索
```

## 使用 Agent

### 方式一：通过 Chat UI

1. 在聊天界面中，点击模型选择器
2. 选择 "Custom Agents" 选项
3. 从列表中选择你要使用的 Agent
4. 开始对话

### 方式二：通过 @Mention

```
@Agents/CodeReviewer 帮我审查这段代码
@Agents/DocumentationWriter 为这个函数生成文档
```

### 方式三：程序化调用

```typescript
// 在插件代码中调用 Agent
await this.iflowService.sendMessage({
    content: "请审查这段代码",
    agent: "CodeReviewer",  // 指定 Agent
    filePath: activeFile?.path
});
```

## 预定义 Agents

### 1. Code Reviewer

```markdown
---
name: "Code Reviewer"
model: "qwen3-coder-plus"
tools: [read_text_file, search_files]
system_prompt: |
  你是代码审查专家，专注于：
  - 代码质量和最佳实践
  - 性能优化建议
  - 安全漏洞检查
  - 可维护性评估
---
```

**用途：** 审查代码、提供改进建议

### 2. Bug Hunter

```markdown
---
name: "Bug Hunter"
model: "deepseek-v3.2-chat"
thinking_enabled: true
tools: [read_text_file, search_files, bash]
system_prompt: |
  你是调试专家，擅长：
  - 定位和修复 bug
  - 分析错误日志
  - 提供调试策略
  - 编写测试用例
---
```

**用途：** 调试问题、分析错误

### 3. Documentation Writer

```markdown
---
name: "Documentation Writer"
model: "kimi-k2.5"
allowed_tools: [read_text_file, write_text_file, search_files]
system_prompt: |
  你是技术文档专家，擅长：
  - 编写清晰的文档
  - 生成代码示例
  - 创建使用指南
  - 维护 API 文档
---
```

**用途：** 编写文档、生成使用说明

### 4. Refactoring Expert

```markdown
---
name: "Refactoring Expert"
model: "qwen3-coder-plus"
mode: "coding"
tools: [read_text_file, write_text_file, edit_file, search_files]
system_prompt: |
  你是重构专家，专注于：
  - 代码重构和优化
  - 设计模式应用
  - 代码解耦和模块化
  - 性能优化
---
```

**用途：** 重构代码、优化结构

### 5. Security Auditor

```markdown
---
name: "Security Auditor"
model: "deepseek-v3.2-chat"
thinking_enabled: true
blocked_tools: [bash]
system_prompt: |
  你是安全审计专家，检查：
  - SQL 注入风险
  - XSS 漏洞
  - 认证和授权问题
  - 敏感数据泄露
  - 依赖安全
---
```

**用途：** 安全审计、漏洞检查

## 创建自定义 Agent

### 步骤

1. **选择目录**

   全局 Agent：`~/.claude/agents/`
   Vault Agent：`{vault}/.claude/agents/`

2. **创建 Agent 文件**

   ```bash
   # 创建全局 Agent
   vim ~/.claude/agents/my-agent.md

   # 或创建 Vault Agent
   vim .claude/agents/my-agent.md
   ```

3. **编写配置**

   ```markdown
   ---
   name: "My Agent"
   description: "我的自定义助手"
   model: "glm-4.7"
   system_prompt: |
     你是一个专门助手...
   ---
   ```

4. **测试 Agent**

   - 重启 Obsidian
   - 打开 iFlow Chat
   - 在模型选择器中找到你的 Agent

## 最佳实践

### 1. 明确定义职责

❌ **不好：** 过于宽泛
```yaml
name: "Helper"
system_prompt: "你是一个有帮助的助手"
```

✅ **好：** 专注领域
```yaml
name: "TypeScript Expert"
system_prompt: |
  你是 TypeScript 专家，专注于：
  - 类型系统设计
  - 类型安全改进
  - TypeScript 最佳实践
```

### 2. 合理限制工具

```yaml
# 文档 Agent 不需要 bash
allowed_tools:
  - read_text_file
  - write_text_file
  - search_files

# 调试 Agent 需要完整权限
tools: [all]
```

### 3. 使用思考模式处理复杂任务

```yaml
# 需要深度分析的 Agent
thinking_enabled: true
```

### 4. 设置合适的模型

```yaml
# 代码任务：使用编程模型
model: "qwen3-coder-plus"

# 对话任务：使用通用模型
model: "glm-4.7"

# 复杂推理：启用思考
model: "kimi-k2-thinking"
thinking_enabled: true
```

### 5. 提供清晰的示例

```yaml
system_prompt: |
  你是 API 文档专家。

  ## 输出格式示例

  ### functionName(param1, param2)
  描述函数功能

  **参数：**
  - `param1`: 类型 - 描述
  - `param2`: 类型 - 描述

  **返回值：** 返回类型

  **示例：**
  \`\`\`typescript
  const result = functionName(arg1, arg2);
  \`\`\`
```

## Agent 组合使用

### 工作流示例

```typescript
// 1. 使用 Bug Hunter 定位问题
@Agents/BugHunter 找出为什么用户登录失败

// 2. 使用 Code Reviewer 审查修复
@Agents/CodeReviewer 审查这个修复方案

// 3. 使用 Documentation Writer 更新文档
@Agents/DocumentationWriter 更新登录流程文档
```

### 链式调用

```
用户: 帮我重构这个函数
  → Agent: Refactoring Expert 重构代码
  → Agent: Code Reviewer 审查重构
  → Agent: Documentation Writer 更新文档
```

## 调试 Agent

### 查看日志

```bash
# 打开 Obsidian 开发者工具
Ctrl/Cmd + Shift + I → Console

# 过滤 Agent 相关日志
Filter: "Agent"
```

### 常见问题

**Q: Agent 没有出现在列表中？**

A: 检查：
1. 文件是否在正确的目录（`~/.claude/agents/` 或 `{vault}/.claude/agents/`）
2. 文件扩展名是否为 `.md`
3. YAML 格式是否正确
4. 必需字段是否都存在

**Q: Agent 行为不符合预期？**

A: 检查：
1. `system_prompt` 是否清晰明确
2. 工具权限是否正确配置
3. 模型是否支持所需功能

**Q: Agent 响应很慢？**

A: 优化：
1. 使用更快的模型
2. 禁用 `thinking_enabled`
3. 减少 `max_turns`
4. 简化 `system_prompt`

## 高级用法

### 动态 Agent 配置

```typescript
// 运行时动态调整 Agent
const agentConfig = {
    name: "Dynamic Agent",
    model: userSettings.preferredModel,
    tools: userSettings.allowedTools,
    system_prompt: generateCustomPrompt(context)
};
```

### Agent 继承

```markdown
---
name: "Senior Code Reviewer"
extends: "CodeReviewer"
experience_level: "senior"
check_security: true
system_prompt: |
  {{parent}}

  作为高级审查者，你还需要：
  - 检查架构设计
  - 评估可扩展性
  - 安全性审计
---
```

### Agent 版本控制

```markdown
---
name: "Code Reviewer"
version: "2.0.0"
changelog: |
  - 增加性能检查
  - 改进安全审计
  - 更新最佳实践
---
```

## 参考

- [Claudian Agents](https://github.com/YishenTu/claudian) - Claude Code 的 Agent 实现
- [iFlow CLI 文档](https://iflow.cli.com/docs/agents) - 官方 Agent 文档
- [DEVELOPMENT.md](DEVELOPMENT.md) - 开发文档
- [CLAUDE.md](CLAUDE.md) - AI 项目理解文档

---

**提示：** 创建 Agent 后，记得在 README 或文档中记录其用途和使用方法！
