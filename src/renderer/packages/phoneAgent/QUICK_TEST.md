# 快速测试 likeLatestInstagramPost API

## 方法 1：浏览器控制台直接调用（最简单）

打开浏览器控制台（F12），复制粘贴以下代码：

```javascript
// 替换为你的 session ID
const sessionId = 'your-session-id-here'
const baseUrl = 'http://localhost:8081'

// 直接调用 API
fetch(`${baseUrl}/v1/sns/ins/tasks/like_latest_post`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    session_id: sessionId
  })
})
  .then(res => res.json())
  .then(data => {
    console.log('✅ API 调用成功！')
    console.log('返回结果:', data)
    return data
  })
  .catch(err => {
    console.error('❌ API 调用失败:', err)
  })
```

## 方法 2：使用测试函数

在浏览器控制台中：

```javascript
// 导入测试函数
const { testLikeLatestPost } = await import('@/packages/phoneAgent/bluestacks')

// 调用测试（替换为你的 session ID）
await testLikeLatestPost('your-session-id-here', 'http://localhost:8081')
```

## 方法 3：在代码中使用

```typescript
import { likeLatestInstagramPost } from '@/packages/phoneAgent/bluestacks'
import { getBluestacksConfig } from '@/packages/phoneAgent/bluestacksTaskHandler'

async function test() {
  const cfg = getBluestacksConfig()
  const sessionId = 'your-session-id'
  
  try {
    const result = await likeLatestInstagramPost(cfg, sessionId, {
      baseUrl: 'http://localhost:8081'
    })
    console.log('✅ 成功:', result)
  } catch (error) {
    console.error('❌ 失败:', error)
  }
}

test()
```

## 获取 Session ID

如果你还没有 session ID，可以先创建一个：

```javascript
// 创建 session
const response = await fetch('http://localhost:8080/v1/session/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'agent' })
})

const data = await response.json()
const sessionId = data.session_id
console.log('Session ID:', sessionId)
```

## 注意事项

1. 确保 `http://localhost:8081` 的服务器正在运行
2. 确保你已经有一个有效的 session ID
3. 如果遇到 CORS 错误，检查服务器配置
4. 如果遇到连接错误，检查服务器是否在正确的端口上运行

