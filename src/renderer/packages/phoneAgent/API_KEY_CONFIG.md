# BlueStacks LLM API Key 配置说明

## 问题

当执行 BlueStacks 任务时，可能会遇到以下错误：

```
HTTP 401: Unauthorized
{"status":"failure","error":"llm_api_key_not_found","message":"Failed to retrieve LLM API key."}
```

## 原因

BlueStacks AI Agent Server 通过 **WebSocket** 从 **BlueStacks AppPlayer** 获取 LLM API Key。

**工作流程：**
1. Chatbox 调用 `POST /v1/task/create`，传入 LLM 配置
2. Agent Server 通过 WebSocket 发送 `get_llm_api_key(provider="GoogleGenAI", model="gemini-2.5-pro")` 到 AppPlayer
3. AppPlayer 返回 API Key
4. 如果 AppPlayer 中没有配置 API Key，会返回 401 错误

## 解决方案

### 方案 1：在 BlueStacks AppPlayer 中配置 API Key（推荐）

1. **打开 BlueStacks AppPlayer**
   - 确保 BlueStacks 已启动

2. **进入 AI Agent 设置**
   - 在 AppPlayer 的设置中找到 "AI Agent" 或 "LLM Settings"
   - 配置 GoogleGenAI API Key

3. **验证配置**
   - 重新启动 BlueStacks AppPlayer（如果需要）
   - 在 Chatbox 中重新测试

### 方案 2：检查 BlueStacks 配置文件

API Key 可能存储在 BlueStacks 的配置文件中。检查以下位置：

**Windows:**
- `%USERPROFILE%\AppData\Local\BlueStacks_nxt\UserData\*.json`
- 或 BlueStacks 安装目录下的配置文件

**macOS:**
- `~/Library/Application Support/BlueStacks/`

### 方案 3：使用 Chatbox 中的 API Key（未来支持）

当前版本中，Chatbox 的 API Key 设置**不会自动同步**到 BlueStacks AppPlayer。

**未来改进：**
- 可以通过 Agent Server 的 API 直接传递 API Key
- 或通过配置文件同步 API Key

## 当前实现

### Chatbox 端

1. **从设置中读取模型配置**
   - `getLLMConfig()` 会尝试从 Chatbox 设置中读取 Gemini/GoogleGenAI 配置
   - 使用配置的模型名称（如果有）

2. **错误提示**
   - 当遇到 API Key 错误时，会显示友好的中文提示
   - 说明需要在 BlueStacks AppPlayer 中配置 API Key

### Agent Server 端

1. **通过 WebSocket 获取 API Key**
   ```python
   # Agent Server 发送请求到 AppPlayer
   message = {
       "execute_instructions": "get_llm_api_key(provider=\"GoogleGenAI\", model=\"gemini-2.5-pro\")"
   }
   await websocket.send_json(message)
   
   # 等待 AppPlayer 响应
   response = await message_queue.get()
   api_key = response.get("llm_api_key")
   ```

2. **如果 API Key 不存在**
   - 返回 401 错误
   - 错误信息：`{"status":"failure","error":"llm_api_key_not_found","message":"Failed to retrieve LLM API key."}`

## 支持的 LLM 提供商

根据 Agent Server 的 `/info` 端点，支持以下提供商：

- **GoogleGenAI**: gemini-3-pro-preview, gemini-2.5-pro, gemini-2.5-flash
- **OpenAI**: gpt-5.1, gpt-5-pro, gpt-5, gpt-5-mini, gpt-5-nano
- **Anthropic**: claude-opus-4-5-20251101, claude-sonnet-4-5, claude-haiku-4-5

## 测试步骤

1. **检查 Agent Server 状态**
   ```bash
   curl http://localhost:8080/info
   ```

2. **在 Chatbox 中测试**
   - 输入：`打开设置`
   - 如果出现 API Key 错误，按照上述方案配置

3. **验证配置**
   - 重新测试任务
   - 应该能正常执行

## 常见问题

### Q: 为什么不能直接从 Chatbox 设置中读取 API Key？

**A:** Agent Server 的设计是通过 WebSocket 从 AppPlayer 获取 API Key，这样可以：
- 保持 API Key 的安全性（不通过网络传输）
- 支持多个 AppPlayer 实例使用不同的 API Key
- 允许用户在 AppPlayer 中管理 API Key

### Q: 能否修改 Agent Server 直接使用 Chatbox 的 API Key？

**A:** 可以，但需要修改 Agent Server 的代码：
1. 修改 `main.py` 中的 `create_task()` 函数
2. 允许通过 HTTP 请求直接传递 API Key（需要安全考虑）
3. 或通过配置文件读取 API Key

### Q: 如何查看当前使用的模型？

**A:** 在错误提示中会显示当前使用的模型，例如：
```
当前使用的模型：GoogleGenAI / gemini-2.5-pro
```

## 未来改进

1. **直接传递 API Key**
   - 修改 Agent Server 支持通过 HTTP 请求传递 API Key
   - 从 Chatbox 设置中读取并传递

2. **API Key 同步**
   - 在 Chatbox 中配置 API Key 后，自动同步到 BlueStacks AppPlayer

3. **多提供商支持**
   - 支持从 Chatbox 设置中选择不同的 LLM 提供商
   - 自动传递对应的 API Key

