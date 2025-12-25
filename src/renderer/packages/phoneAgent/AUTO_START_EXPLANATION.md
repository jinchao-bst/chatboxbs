# BlueStacks 自动启动机制说明

## 关键发现

### 1. **BlueStacks AI Agent Server (Python 端) 的自动启动逻辑**

**✅ 会自动启动：BlueStacks AppPlayer (HD-Player.exe)**

在 `ap-ai-agent/agent/main.py` 中：

```python
async def create_new_session(request: SessionRequest):
    if request.mode == "agent":
        # 自动启动 BlueStacks AppPlayer
        await launch_bluestacks(session_id=session.session_id, instance_id=session.instance_id)
```

`launch_bluestacks()` 函数（在 `ap-ai-agent/agent/utils.py` 中）：

```python
async def launch_bluestacks(session_id: str, instance_id: str = None):
    """Launch BlueStacks application with AI agent parameters."""
    executable_path = get_bluestacks_path()  # 获取 HD-Player.exe 路径
    
    args = [executable_path]  # HD-Player.exe
    args.extend([
        "--cmd", "launchAi",
        "--aiHostUrl", host_url,
        "--aiPort", str(port),
        "--aiSessionId", session_id,
    ])
    
    # 启动 BlueStacks AppPlayer
    process = await asyncio.create_subprocess_exec(*args, ...)
```

**❌ 不会自动启动：BlueStacksAI.exe**

- `BlueStacksAI.exe` 就是 Agent Server 本身
- Agent Server 不能启动自己
- 需要**手动启动**或通过其他工具启动

### 2. **启动流程**

```
用户操作
  ↓
1. 手动启动 BlueStacksAI.exe (Agent Server)
  ↓
2. Agent Server 监听 http://localhost:8080
  ↓
3. Chatbox 调用 POST /v1/session/create (mode="agent")
  ↓
4. Agent Server 自动启动 HD-Player.exe (BlueStacks AppPlayer)
  ↓
5. HD-Player.exe 连接到 Agent Server 的 WebSocket
  ↓
6. 开始执行任务
```

### 3. **tools/il 中的启动代码**

在 `ap-ai-agent/tools/il/main_gui.py` 中有启动 BlueStacksAI.exe 的代码：

```python
def start_bluestacks(self):
    # 启动 HD-Player
    if not self.is_process_running("HD-Player.exe"):
        subprocess.Popen([HD_PLAYER_PATH], shell=True)
    
    # 启动 BlueStacksAI (Agent Server)
    if not self.is_process_running("BlueStacksAI.exe"):
        subprocess.Popen([BLUESTACKS_AI_PATH], shell=True)
```

**但这是测试工具**，不是 Agent Server 的一部分。

## 总结

| 组件 | 自动启动？ | 说明 |
|------|-----------|------|
| **BlueStacksAI.exe** | ❌ 否 | Agent Server 本身，需要手动启动 |
| **HD-Player.exe** | ✅ 是 | Agent Server 会自动启动（当 mode="agent" 时） |

## 解决方案

### 方案 1：手动启动（当前）

1. 手动运行 `BlueStacksAI.exe`
2. 等待服务器启动（监听 8080 端口）
3. 在 Chatbox 中使用

### 方案 2：在 Chatbox 中添加自动启动（推荐）

在 Chatbox 的 Electron 主进程中添加启动 BlueStacksAI.exe 的功能：

```typescript
// src/main/bluestacks-launcher.ts
export async function startBluestacksAI(): Promise<{ success: boolean; message: string }> {
  // 检查是否已运行
  if (isBluestacksAIRunning()) {
    return { success: true, message: 'Already running' }
  }
  
  // 启动 BlueStacksAI.exe
  const exePath = getBluestacksAIPath()
  spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref()
  
  // 等待启动
  await new Promise(resolve => setTimeout(resolve, 5000))
  
  return { success: true, message: 'Started' }
}
```

然后在 `agent.initialize()` 中调用：

```typescript
// 1. 检查 Agent Server 是否运行
const serverReachable = await bsClient.pingServer(this.cfg)
if (!serverReachable) {
  // 2. 尝试自动启动 BlueStacksAI.exe
  const { startBluestacksAI } = await import('@/main/bluestacks-launcher')
  const result = await startBluestacksAI()
  if (!result.success) {
    throw new Error(result.message)
  }
  // 3. 等待服务器启动
  await new Promise(resolve => setTimeout(resolve, 5000))
  // 4. 再次检查
  const stillNotReachable = !(await bsClient.pingServer(this.cfg))
  if (stillNotReachable) {
    throw new Error('Failed to start BlueStacks AI Agent Server')
  }
}
```

## 当前状态

- ✅ Agent Server 会自动启动 HD-Player.exe
- ❌ Agent Server **不会**自动启动 BlueStacksAI.exe
- ✅ 可以在 Chatbox 中添加自动启动 BlueStacksAI.exe 的功能

