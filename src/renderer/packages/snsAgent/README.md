# SNS Agent - Instagram Automation Agent

SNS Agent 是一个类似 PhoneAgent 的功能，专门用于 Instagram 自动化操作，如点赞、关注等。

## 功能特性

- ✅ **点赞功能**: 支持点赞指定用户的最新帖子
- ✅ **任务检测**: 自动检测包含 Instagram 相关关键词的消息
- ✅ **进度跟踪**: 实时显示任务执行进度
- ✅ **错误处理**: 完善的错误处理和用户提示
- ✅ **取消支持**: 支持取消正在执行的任务

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    Chatbox UI                            │
│  (User types: "点赞 @username 的最新帖子")              │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         SNS Task Handler                                 │
│  - Detects SNS tasks                                     │
│  - Extracts username                                     │
│  - Manages task execution                               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              SNS Client (TypeScript)                     │
│  - HTTP client for SNS API                               │
│  - Calls like_latest_post endpoint                      │
│  - Polls task status                                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  BlueStacks Client (for session creation)               │
│  - Creates BlueStacks session                            │
│  - Gets session_id for SNS API                           │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
                    ┌──────────────────────────────┐
                    │  SNS API Server               │
                    │  (Python, port 8081)          │
                    │  - Task execution             │
                    │  - Status tracking            │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │  BlueStacks Agent Server      │
                    │  (Python, port 8080)          │
                    │  - Device control             │
                    │  - Instagram automation       │
                    └──────────────────────────────┘
```

## 文件结构

```
src/renderer/packages/snsAgent/
├── snsClient.ts          # SNS API HTTP client
├── snsTaskHandler.ts     # Task handler and integration
├── index.ts              # Main entry point
└── README.md             # This file
```

## 使用方法

### 1. 在 Chatbox 中使用

用户只需在聊天中输入包含 Instagram 相关关键词的消息，系统会自动检测并执行：

**示例消息:**
- "点赞 @instagram 的最新帖子"
- "like @username's latest post"
- "给 @username 点赞"

### 2. 任务检测关键词

系统会自动检测以下关键词：
- 中文: 点赞, 关注, 取消关注, instagram, ins, sns, 帖子, post, reels
- 英文: like, follow, unfollow, instagram, ins, sns, post, reels

### 3. 用户名提取

系统支持多种格式提取用户名：
- `@username`
- `点赞 @username`
- `like @username`
- `给 @username 点赞`
- `username 的最新帖子`
- `username latest post`

## API 端点

### POST /v1/sns/ins/tasks/like_latest_post

点赞指定用户的最新帖子。

**请求:**
```json
{
  "session_id": "blue stacks-session-id",
  "username": "instagram_username"
}
```

**响应:**
```json
{
  "status": "success",
  "message": "Like latest post task started",
  "success": true,
  "task_id": "uuid-task-id"
}
```

### GET /v1/sns/ins/tasks/{task_id}/status

查询任务状态。

**响应:**
```json
{
  "status": "success",
  "task_id": "uuid-task-id",
  "task_status": "running" | "completed" | "failed" | "cancelled",
  "progress": 50.0,
  "history": [...]
}
```

### POST /v1/sns/ins/tasks/{task_id}/cancel

取消任务。

## 配置

### SNS API 服务器地址

默认: `http://localhost:8081`

修改位置: `src/renderer/packages/snsAgent/snsTaskHandler.ts`

```typescript
export function getSNSConfig(): SNSConfig {
  return {
    baseUrl: 'http://your-server:8081',
  }
}
```

## 集成点

### 1. Session Actions

在 `src/renderer/stores/sessionActions.ts` 中集成了 SNS 任务检测和处理：

```typescript
// Check if this is a SNS automation task
const { isSNSTask, handleSNSTask } = await import('@/packages/snsAgent/snsTaskHandler')

if (isSNSTask(userText)) {
  // Handle SNS automation task
  await handleSNSTask({...})
}
```

### 2. Copilots

在 `src/renderer/hooks/useCopilots.ts` 中添加了默认的 SNS Assistant copilot：

- **ID**: `sns-copilot`
- **名称**: SNS Assistant
- **图标**: Instagram 图标
- **功能**: 帮助用户在 Instagram 上完成自动化操作

## 前置条件

1. **BlueStacks AI Agent Server** 必须运行在 `http://localhost:8080`
2. **SNS API Server** 必须运行在 `http://localhost:8081`
3. **BlueStacks AppPlayer** 必须已安装并可以启动
4. **Instagram** 应用必须已安装在 BlueStacks 中

## 错误处理

### 常见错误

1. **无法连接到 SNS API 服务器**
   - 确保 SNS API 服务器正在运行
   - 检查端口 8081 是否被占用

2. **无法提取用户名**
   - 确保消息格式正确
   - 使用 `@username` 格式

3. **无法创建 BlueStacks session**
   - 确保 BlueStacks AI Agent Server 正在运行
   - 检查 BlueStacks 是否已安装

## 未来扩展

- [ ] 支持更多 Instagram 操作（关注、取消关注、评论等）
- [ ] 支持批量操作
- [ ] 支持任务调度
- [ ] 支持更多社交平台（Twitter, Facebook 等）

## 相关文档

- [SNS API 文档](../../../../ap-ai-agent/agent/sns/API_DOCUMENTATION.md)
- [SNS API 总结](../../../../ap-ai-agent/agent/sns/API_SUMMARY.md)
- [PhoneAgent 文档](../phoneAgent/README.md)

