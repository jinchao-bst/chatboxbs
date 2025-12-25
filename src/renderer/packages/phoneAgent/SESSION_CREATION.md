# BlueStacks Session 创建和自动启动机制

## 1. tools/il 中的 Session 创建

### 1.1 创建 Session（helper.py）

在 `ap-ai-agent/tools/il/helper.py` 中，`BlueStacksAgent` 类提供了创建 session 的方法：

```python
async def create_session(
    self,
    mode: str = "agent",
    instance_id: Optional[str] = None,
) -> dict:
    """Create a new session with the agent."""
    payload = {
        "mode": mode,
    }
    if instance_id:
        payload["instance_id"] = instance_id

    response = await self.client.post(
        f"{self.base_url}/v1/session/create",
        json=payload
    )

    result = response.json()
    if result.get("status") == "success":
        return result
    return {"status": "failure", ...}
```

**使用示例**（main.py）：
```python
agent = BlueStacksAgent()
session_result = await agent.create_session()
if session_result.get("status") != "success":
    print(f"ERROR: Failed to create session")
    return

session_id = session_result["session_id"]
print(f"Session ID: {session_id}")
```

### 1.2 自动启动 BlueStacks

#### 方式 1：通过 Agent Server 自动启动（推荐）

在 `ap-ai-agent/agent/main.py` 的 `create_new_session()` 函数中：

```python
async def create_new_session(request: SessionRequest):
    """Create a new AI agent session."""
    session = session_manager.create_session(request=request)
    
    if request.mode == "agent":
        # 创建连接等待器
        connection_event = connection_manager.create_connection_waiter(session.session_id)
        
        # 自动启动 BlueStacks
        await launch_bluestacks(session_id=session.session_id, instance_id=session.instance_id)
        
        # 等待 WebSocket 连接建立（超时 30 秒）
        try:
            await asyncio.wait_for(connection_event.wait(), timeout=30)
            logging.info(f"WebSocket connection established for session {session.session_id}")
        except asyncio.TimeoutError:
            # 连接超时
            return JSONResponse(status_code=503, ...)
    
    return {"status": "success", "session_id": session.session_id}
```

`launch_bluestacks()` 函数（在 `ap-ai-agent/agent/utils.py` 中）：

```python
async def launch_bluestacks(session_id: str, instance_id: str = None):
    """Launch BlueStacks application with AI agent parameters."""
    executable_path = get_bluestacks_path()  # 获取 BlueStacks 可执行文件路径
    
    port = Config.get_port()  # 默认 8080
    host_url = "http://127.0.0.1"
    
    args = [executable_path]
    if instance_id:
        args.extend(["--instance", instance_id])
    
    # 关键参数：告诉 BlueStacks 连接到 AI Agent Server
    args.extend([
        "--cmd", "launchAi",
        "--aiHostUrl", host_url,
        "--aiPort", str(port),
        "--aiSessionId", session_id,
    ])
    
    # 启动 BlueStacks 进程
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True
    )
```

**关键点**：
- 当 `mode="agent"` 时，Agent Server 会自动调用 `launch_bluestacks()`
- BlueStacks 启动时会通过命令行参数连接到 Agent Server
- Agent Server 会等待 WebSocket 连接建立（最多 30 秒）

#### 方式 2：手动启动 BlueStacks（main_gui.py）

在 `ap-ai-agent/tools/il/main_gui.py` 中，`ILAgentGUI` 类提供了手动启动方法：

```python
def start_bluestacks(self):
    """Start BlueStacks if not running"""
    # 检查 HD-Player 是否运行
    if not self.is_process_running("HD-Player.exe"):
        self.log("Starting BlueStacks HD-Player...", "INFO")
        if os.path.exists(HD_PLAYER_PATH):
            subprocess.Popen([HD_PLAYER_PATH], shell=True)
            time.sleep(8)  # 等待启动
    
    # 检查 BlueStacksAI 是否运行
    if not self.is_process_running("BlueStacksAI.exe"):
        self.log("Starting BlueStacks AI Agent...", "INFO")
        if os.path.exists(BLUESTACKS_AI_PATH):
            subprocess.Popen([BLUESTACKS_AI_PATH], shell=True)
            time.sleep(5)  # 等待启动
```

**路径**：
- Windows: `C:\Program Files\BlueStacks_nxt\HD-Player.exe`
- Windows: `C:\Program Files\BlueStacks_nxt\BlueStacksAI.exe`

## 2. SDK 中的 Session 创建

### 2.1 SDK 的 Session 管理（sdk/python/bluestacks/agent.py）

SDK 使用**延迟创建**（lazy creation）机制：

```python
async def _ensure_session(self) -> str:
    """
    Lazily creates a session if not already created.
    
    Calls: POST /v1/session/create
    """
    if self._session_id is not None:
        return self._session_id
    
    payload: Dict[str, Any] = {}
    
    # 从配置中获取 instance_id 等参数
    if self.config.instance_config:
        payload.update(self.config.instance_config)
    
    # 默认值
    payload.setdefault("ui", True)
    payload.setdefault("input", False)
    
    # 调用 API 创建 session
    data = await self._post("/v1/session/create", payload)
    
    if data.get("status") != "success":
        raise SessionCreationError(...)
    
    self._session_id = data["session_id"]
    return self._session_id
```

### 2.2 SDK 使用示例

```python
from bluestacks import BluestacksAgent, BluestacksAgentConfig

# 配置 SDK
config = BluestacksAgentConfig(
    llm_config={
        "provider": "GoogleGenAI",
        "model": "gemini-2.5-pro",
        "api_key": "YOUR_API_KEY",
    },
    instance_config={
        "instance_id": "Pie64",  # BlueStacks 实例 ID
    },
)

# 初始化 agent（此时还没有创建 session）
agent = BluestacksAgent(config)

# 第一次调用任何需要 session 的方法时，会自动创建 session
result = await agent.run_task("open settings app")
# 内部会调用 _ensure_session() -> POST /v1/session/create

# 关闭 session
await agent.close()
```

### 2.3 SDK 不会自动启动 BlueStacks

**重要**：SDK 本身**不会**自动启动 BlueStacks。需要：

1. **方式 1**：BlueStacks 已经运行，然后通过 Agent Server 创建 session
2. **方式 2**：通过 Agent Server 的 `launch_bluestacks()` 自动启动（当 `mode="agent"` 时）

## 3. 在 Chatbox 中的集成

### 3.1 当前实现

在 `src/renderer/packages/phoneAgent/agent.ts` 中：

```typescript
async initialize(): Promise<void> {
  if (this.sessionId) {
    return // Already initialized
  }

  // 调用 createSession API
  const result = await bsClient.createSession(
    this.cfg, 
    'agent',  // mode
    this.agentConfig.instanceId
  )
  
  if (!result.session_id) {
    throw new Error('Failed to create session: no session_id returned')
  }
  
  this.sessionId = result.session_id
  // ...
}
```

### 3.2 需要改进的地方

当前实现**没有自动启动 BlueStacks**。需要：

1. **检查 BlueStacks 是否运行**
2. **如果没有运行，调用 Agent Server 的自动启动机制**

**改进方案**：

```typescript
async initialize(): Promise<void> {
  if (this.sessionId) {
    return
  }

  // 1. 创建 session（mode="agent" 会自动启动 BlueStacks）
  const result = await bsClient.createSession(
    this.cfg, 
    'agent',  // 关键：使用 "agent" 模式
    this.agentConfig.instanceId
  )
  
  if (!result.session_id) {
    throw new Error('Failed to create session')
  }
  
  this.sessionId = result.session_id
  
  // 2. 等待连接建立（可选，如果需要确保连接）
  // Agent Server 会自动等待 WebSocket 连接，最多 30 秒
  // 如果超时，会返回 503 错误
}
```

## 4. 总结

### Session 创建流程

1. **调用 `POST /v1/session/create`**
   - 参数：`mode`（"agent" 或 "chat"），`instance_id`（可选）
   - 返回：`{"status": "success", "session_id": "..."}`

2. **如果 `mode="agent"`**：
   - Agent Server 自动调用 `launch_bluestacks()`
   - 启动 BlueStacks 进程，传入 session_id
   - 等待 WebSocket 连接建立（最多 30 秒）

3. **如果 `mode="chat"`**：
   - 不启动 BlueStacks
   - 立即返回 session_id

### 关键区别

| 方式 | 自动启动 BlueStacks | 适用场景 |
|------|-------------------|---------|
| `mode="agent"` | ✅ 是 | 需要自动化控制 |
| `mode="chat"` | ❌ 否 | 仅聊天，不控制设备 |
| SDK `_ensure_session()` | ❌ 否 | 需要 BlueStacks 已运行 |

### 推荐做法

在 Chatbox 中：
1. 使用 `mode="agent"` 创建 session
2. Agent Server 会自动启动 BlueStacks（如果未运行）
3. 等待连接建立后，开始执行任务

