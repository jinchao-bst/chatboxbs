# BlueStacks PhoneAgent 使用指南

## 如何在 Chatbox 中使用 `mode="agent"` 创建 Session

### 当前实现状态

✅ **已经正确实现**：代码中已经使用 `mode="agent"` 创建 session

在 `src/renderer/packages/phoneAgent/agent.ts` 中：

```typescript
async initialize(): Promise<void> {
  if (this.sessionId) {
    return // Already initialized
  }

  // ✅ 已经使用 mode="agent"
  const result = await bsClient.createSession(
    this.cfg, 
    'agent',  // mode="agent" 会自动启动 BlueStacks
    this.agentConfig.instanceId
  )
  
  if (!result.session_id) {
    throw new Error('Failed to create session: no session_id returned')
  }
  
  this.sessionId = result.session_id
  // ...
}
```

### 工作流程

1. **用户输入任务**（如 "打开设置"）
2. **检测为 BlueStacks 任务** → `isBluestacksTask()` 返回 `true`
3. **创建 PhoneAgent 实例**
4. **调用 `agent.initialize()`**
   - 内部调用 `createSession(cfg, 'agent', instanceId)`
   - Agent Server 收到请求，`mode="agent"`
   - Agent Server 自动调用 `launch_bluestacks()`
   - 启动 BlueStacks 进程
   - 等待 WebSocket 连接建立（最多 30 秒）
5. **开始执行任务**

### 使用示例

#### 1. 基本使用（当前实现）

```typescript
import { PhoneAgent } from '@/packages/phoneAgent'
import { getBluestacksConfig } from '@/packages/phoneAgent/bluestacksTaskHandler'

// 配置
const bsConfig = getBluestacksConfig()  // { baseUrl: 'http://localhost:8080' }
const agentConfig = {
  maxSteps: 50,
  instanceId: 'Pie64',  // 可选，BlueStacks 实例 ID
  lang: 'cn',
}

// 创建 agent
const agent = new PhoneAgent(bsConfig, agentConfig)

// 初始化（会自动创建 session 并启动 BlueStacks）
await agent.initialize()

// 执行任务
const result = await agent.run("打开设置", llmConfig)

// 关闭
await agent.close()
```

#### 2. 在 Chatbox 会话中使用

当用户在聊天中输入 "打开设置" 时：

```typescript
// 在 sessionActions.ts 中
if (isBluestacksTask(userText)) {
  await handleBluestacksTask({
    sessionId,
    userMessage,
    assistantMessage: targetMsg,
    onStepUpdate: async (stepResult, screenshot) => {
      // 更新消息显示
    },
    onComplete: async (finalMessage) => {
      // 任务完成
    },
    onError: async (error) => {
      // 错误处理
    },
  })
}
```

### 错误处理

#### 1. Session 创建失败

```typescript
try {
  const result = await bsClient.createSession(cfg, 'agent', instanceId)
  if (result.status !== 'success') {
    // 处理错误
    console.error('Session creation failed:', result)
  }
} catch (error) {
  // 网络错误或服务器错误
  console.error('Failed to create session:', error)
}
```

#### 2. BlueStacks 连接超时

当 `mode="agent"` 时，Agent Server 会等待 WebSocket 连接建立（最多 30 秒）。

如果超时，会返回：
```json
{
  "status": "failure",
  "error": "bluestacks_connection_failed",
  "message": "Failed to establish connection with BlueStacks."
}
```

**处理方式**：
```typescript
const result = await bsClient.createSession(cfg, 'agent', instanceId)

if (result.status === 'failure' && result.error === 'bluestacks_connection_failed') {
  // 提示用户：
  // 1. 检查 BlueStacks 是否已安装
  // 2. 检查 BlueStacks 是否正在启动
  // 3. 等待更长时间后重试
}
```

### 改进建议

#### 1. 添加连接状态检查

可以添加一个方法来检查连接状态：

```typescript
// 在 agent.ts 中添加
async waitForConnection(timeout = 30000): Promise<boolean> {
  if (!this.sessionId) {
    throw new Error('Session not initialized')
  }
  
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    try {
      const status = await bsClient.getBluestacksStatus(this.cfg, this.sessionId)
      if (status.connected) {
        return true
      }
    } catch (e) {
      // 继续等待
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}
```

#### 2. 改进错误提示

在 `bluestacksTaskHandler.ts` 中：

```typescript
export async function handleBluestacksTask(options: BluestacksTaskOptions): Promise<void> {
  try {
    await agent.initialize()
    
    // 可选：等待连接建立
    // const connected = await agent.waitForConnection()
    // if (!connected) {
    //   throw new Error('BlueStacks connection timeout')
    // }
    
    const llmConfig = getLLMConfig()
    const result = await agent.run(userText, llmConfig)
    await onComplete(result)
  } catch (error) {
    // 提供更友好的错误信息
    if (error.message.includes('bluestacks_connection_failed')) {
      await onError(new Error(
        '无法连接到 BlueStacks。请确保：\n' +
        '1. BlueStacks 已安装\n' +
        '2. BlueStacks AI Agent Server 正在运行\n' +
        '3. 等待 BlueStacks 完全启动后重试'
      ))
    } else {
      await onError(error)
    }
  }
}
```

### 配置说明

#### 1. BlueStacks 服务器地址

默认：`http://localhost:8080`

修改位置：`src/renderer/packages/phoneAgent/bluestacksTaskHandler.ts`

```typescript
export function getBluestacksConfig(): BluestacksConfig {
  return {
    baseUrl: 'http://your-server:8080',  // 修改这里
  }
}
```

#### 2. BlueStacks 实例 ID

默认：`undefined`（使用默认实例）

指定实例：
```typescript
const agentConfig: AgentConfig = {
  instanceId: 'Pie64',  // 或 'Nougat64', 'Rvc64' 等
}
```

#### 3. LLM 配置

修改位置：`src/renderer/packages/phoneAgent/bluestacksTaskHandler.ts`

```typescript
export function getLLMConfig(): any {
  return {
    provider: 'GoogleGenAI',  // 或 'OpenAI', 'Anthropic'
    model: 'gemini-2.5-pro',
    temperature: 0.2,
    max_tokens: 4096,
    max_steps: 25,
    timeout: 1200,
    vision: true,
    accessibility: true,
  }
}
```

### 测试步骤

1. **确保 BlueStacks AI Agent Server 运行**
   ```bash
   # 检查是否在运行
   # Windows: 查看任务管理器中的 BlueStacksAI.exe
   # 或访问 http://localhost:8080/info
   ```

2. **在 Chatbox 中测试**
   - 打开 "蓝叠" 会话
   - 输入：`打开设置`
   - 观察：
     - Session 创建
     - BlueStacks 自动启动（如果未运行）
     - 任务执行过程

3. **查看日志**
   - 浏览器控制台（F12）
   - Agent Server 日志
   - BlueStacks 日志

### 常见问题

#### Q: BlueStacks 没有自动启动？

**A**: 检查：
1. Agent Server 是否正常运行
2. BlueStacks 安装路径是否正确
3. 查看 Agent Server 日志中的错误信息

#### Q: 连接超时？

**A**: 
1. 等待更长时间（BlueStacks 启动需要 10-30 秒）
2. 检查防火墙设置
3. 手动启动 BlueStacks 后再创建 session

#### Q: 如何手动启动 BlueStacks？

**A**: 
```bash
# Windows
"C:\Program Files\BlueStacks_nxt\HD-Player.exe"
```

或者使用 `mode="chat"` 创建 session（不会自动启动）

### 总结

✅ **当前实现已经正确**：使用 `mode="agent"` 创建 session

✅ **自动启动已启用**：Agent Server 会自动启动 BlueStacks

⚠️ **需要改进**：
- 添加连接状态检查
- 改进错误提示
- 添加重试机制

