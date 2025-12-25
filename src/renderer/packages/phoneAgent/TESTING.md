# BlueStacks PhoneAgent 测试指南

## 前置条件

1. **BlueStacks 模拟器已安装并运行**
   - 确保 BlueStacks 已启动
   - 默认实例通常是 `Pie64`

2. **BlueStacks AI Agent Server 已启动**
   - 默认地址：`http://localhost:8080`
   - 确保服务器正在运行并可以访问

3. **LLM 配置**
   - 需要在 BlueStacks Agent Server 中配置 LLM API Key
   - 支持的提供商：GoogleGenAI, OpenAI, Anthropic
   - 默认使用：GoogleGenAI / gemini-2.5-pro

## 测试步骤

### 1. 启动 Chatbox 应用

```bash
npm run dev
```

### 2. 在 Chatbox 中测试

1. **打开"蓝叠"会话**
   - 在左侧会话列表中找到"蓝叠"入口（蓝色图标）
   - 点击进入会话

2. **输入任务指令**
   在输入框中输入以下任一指令：
   - `打开设置` 或 `打开setting`
   - `打开Settings`
   - `打开Chrome浏览器`
   - `打开微信`

3. **观察执行过程**
   系统会自动：
   - ✅ 检测到这是 BlueStacks 任务
   - ✅ 创建与 BlueStacks 的连接会话
   - ✅ 开始执行自动化任务
   - ✅ 实时显示：
     - 思考过程（reasoning）
     - 每一步的截图
     - 执行的动作
     - 任务状态

## 预期行为

### 消息显示内容

在聊天界面中，你会看到：

1. **初始状态**
   ```
   正在连接 BlueStacks 并执行任务...
   ```

2. **每个步骤**
   ```
   **步骤 1**
   
   执行动作: {
     "_metadata": "do",
     "action": "Launch",
     "app": "Settings"
   }
   
   结果: App launched successfully
   
   ⏳ 进行中...
   ```
   
   - 同时显示该步骤的截图（如果可用）
   - 显示 AI 的思考过程（如果可用）

3. **任务完成**
   ```
   ✅ **任务完成**
   
   成功打开了设置应用
   ```

## 故障排查

### 问题：任务没有被识别为 BlueStacks 任务

**解决方案：**
- 确保消息包含关键词：`打开`、`open`、`设置`、`settings`、`应用`、`app` 等
- 检查 `isBluestacksTask()` 函数的关键词列表

### 问题：连接 BlueStacks 失败

**错误信息：** `Failed to create session: bluestacks_connection_failed`

**解决方案：**
1. 确保 BlueStacks 模拟器正在运行
2. 检查 BlueStacks AI Agent Server 是否在 `http://localhost:8080` 运行
3. 检查防火墙设置
4. 查看 BlueStacks Agent Server 的日志

### 问题：LLM API Key 未找到

**错误信息：** `llm_api_key_not_found`

**解决方案：**
- 在 BlueStacks Agent Server 中配置 LLM API Key
- 确保 API Key 有效且有足够的配额

### 问题：截图不显示

**可能原因：**
- 截图获取失败（网络问题或 BlueStacks 连接问题）
- 图片保存失败（存储空间问题）

**解决方案：**
- 检查浏览器控制台的错误信息
- 确保有足够的存储空间
- 检查网络连接

## 调试技巧

### 1. 查看控制台日志

打开 DevTools (F12)，查看 Console 标签：
- PhoneAgent 的详细执行日志
- 错误信息和堆栈跟踪

### 2. 检查网络请求

在 DevTools 的 Network 标签中：
- 查看对 `http://localhost:8080` 的请求
- 检查请求和响应内容

### 3. 查看消息内容

在聊天界面中：
- 每个步骤的消息会实时更新
- 可以查看完整的思考过程和动作详情

## 配置说明

### 修改 BlueStacks 服务器地址

编辑 `src/renderer/packages/phoneAgent/bluestacksTaskHandler.ts`：

```typescript
export function getBluestacksConfig(): BluestacksConfig {
  return {
    baseUrl: 'http://your-server:8080', // 修改这里
  }
}
```

### 修改 LLM 配置

编辑 `src/renderer/packages/phoneAgent/bluestacksTaskHandler.ts`：

```typescript
export function getLLMConfig(): any {
  return {
    provider: 'OpenAI', // 修改提供商
    model: 'gpt-4-vision-preview', // 修改模型
    temperature: 0.2,
    max_tokens: 4096,
    max_steps: 25,
    timeout: 1200,
    vision: true,
    accessibility: true,
  }
}
```

### 修改任务检测关键词

编辑 `src/renderer/packages/phoneAgent/bluestacksTaskHandler.ts`：

```typescript
export function isBluestacksTask(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const taskKeywords = [
    '打开',
    'open',
    // 添加更多关键词...
  ]
  return taskKeywords.some((keyword) => lowerMessage.includes(keyword))
}
```

## 示例任务

以下是一些可以测试的任务：

1. **打开应用**
   - `打开设置`
   - `打开Chrome`
   - `打开微信`

2. **组合任务**
   - `打开设置并进入关于手机`
   - `打开Chrome并搜索AI`

3. **复杂任务**
   - `打开微信，找到联系人John，发送消息"Hello"`

## 注意事项

- 首次运行可能需要一些时间来建立连接
- 每个步骤之间会有延迟（等待 UI 响应）
- 截图可能会因为敏感屏幕而失败（返回黑色图片）
- 任务执行时间取决于任务复杂度

## 下一步

- 添加更多应用名称映射
- 优化截图显示
- 添加任务历史记录
- 支持任务暂停和恢复

