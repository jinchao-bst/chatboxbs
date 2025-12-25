import { EventSourcePolyfill } from 'event-source-polyfill'

export type BluestacksConfig = {
  baseUrl: string // e.g. http://localhost:8080
}

/**
 * Check if BlueStacks AI Agent Server is reachable
 */
export async function pingServer(cfg: BluestacksConfig): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/info`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    })
    return res.ok
  } catch (error) {
    return false
  }
}

export type ToolResponse<T = any> = {
  status: 'success' | 'failure'
  output?: string
  data?: T
  error?: string
  message?: string
}

async function http<T>(method: string, url: string, body?: any): Promise<T> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText} ${text}`)
    }
    return res.json() as Promise<T>
  } catch (error) {
    // Handle network errors (connection refused, timeout, etc.)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const urlObj = new URL(url)
      throw new Error(
        `无法连接到 BlueStacks AI Agent Server (${urlObj.host})\n\n` +
        `请确保：\n` +
        `1. BlueStacks AI Agent Server 正在运行\n` +
        `2. 服务器地址正确: ${urlObj.origin}\n` +
        `3. 防火墙未阻止连接\n\n` +
        `原始错误: ${error.message}`
      )
    }
    throw error
  }
}

// Session
export async function createSession(cfg: BluestacksConfig, mode = 'agent', instanceId?: string) {
  return http<{ status: string; session_id?: string; error?: string; message?: string }>(
    'POST',
    `${cfg.baseUrl}/v1/session/create`,
    {
      mode,
      instance_id: instanceId ?? null,
      metadata: {},
    }
  )
}

export async function closeSession(cfg: BluestacksConfig, sessionId: string) {
  return http<{ status: string }>('POST', `${cfg.baseUrl}/v1/session/close`, { session_id: sessionId })
}


// Task
export async function createTask(
  cfg: BluestacksConfig,
  sessionId: string,
  query: string,
  llm: any,
  metadata?: any
) {
  try {
    const response = await http<{ status: string; task_id?: string; error?: string; message?: string }>(
      'POST',
      `${cfg.baseUrl}/v1/task/create`,
      {
        session_id: sessionId,
        llm,
        query,
        metadata,
      }
    )
    
    // Check if response indicates failure
    if (response.status === 'failure') {
      const errorObj: any = {
        status: 'failure',
        error: response.error || 'task_creation_failed',
        message: response.message || 'Failed to create task',
      }
      throw errorObj
    }
    
    return response as { status: string; task_id: string }
  } catch (error: any) {
    // Handle 401 Unauthorized (LLM API Key not found)
    if (error instanceof Error && error.message.includes('401')) {
      const errorObj: any = {
        status: 'failure',
        error: 'llm_api_key_not_found',
        message: 'Failed to retrieve LLM API key from BlueStacks AppPlayer.',
      }
      throw errorObj
    }
    
    // If error is already an object with status/error, re-throw as-is
    if (error && typeof error === 'object' && 'status' in error && 'error' in error) {
      throw error
    }
    
    throw error
  }
}

export async function resumeTask(
  cfg: BluestacksConfig,
  sessionId: string,
  taskId: string,
  resumeQuery: string,
  metadata?: any
) {
  return http<{ status: string }>('POST', `${cfg.baseUrl}/v1/task/resume`, {
    session_id: sessionId,
    task_id: taskId,
    resume_query: resumeQuery,
    metadata,
  })
}

export async function taskStatus(cfg: BluestacksConfig, sessionId: string, taskId: string) {
  const params = new URLSearchParams({ session_id: sessionId, task_id: taskId })
  return http<any>('GET', `${cfg.baseUrl}/v1/task/status?${params.toString()}`)
}

export async function stopTask(cfg: BluestacksConfig, sessionId: string, taskId: string) {
  return http<{ status: string }>('POST', `${cfg.baseUrl}/v1/task/stop`, { session_id: sessionId, task_id: taskId })
}

// Tools
export async function tap(cfg: BluestacksConfig, sessionId: string, x: number, y: number) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/tap`, { session_id: sessionId, x, y })
}

export async function swipe(
  cfg: BluestacksConfig,
  sessionId: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number
) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/swipe`, {
    session_id: sessionId,
    start_x: startX,
    start_y: startY,
    end_x: endX,
    end_y: endY,
    duration_ms: durationMs,
  })
}

export async function inputText(cfg: BluestacksConfig, sessionId: string, text: string) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/input_text`, { session_id: sessionId, text })
}

export async function pressKey(cfg: BluestacksConfig, sessionId: string, keycode: number) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/press_key`, { session_id: sessionId, keycode })
}

export async function screenshot(cfg: BluestacksConfig, sessionId: string, opts?: { grid_enabled?: boolean }) {
  const params = new URLSearchParams({ session_id: sessionId })
  if (opts?.grid_enabled) params.set('grid_enabled', 'true')
  return http<ToolResponse<{ screenshot_base64: string }>>(
    'GET',
    `${cfg.baseUrl}/v1/tools/screenshot?${params.toString()}`
  )
}

export async function startApp(
  cfg: BluestacksConfig,
  sessionId: string,
  packageName: string,
  activity: string
) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/start_app`, {
    session_id: sessionId,
    package: packageName,
    activity,
  })
}

export async function back(cfg: BluestacksConfig, sessionId: string) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/back`, { session_id: sessionId })
}

export async function home(cfg: BluestacksConfig, sessionId: string) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/home`, { session_id: sessionId })
}

export async function delay(cfg: BluestacksConfig, sessionId: string, ms: number) {
  return http<ToolResponse>('POST', `${cfg.baseUrl}/v1/tools/delay`, { session_id: sessionId, ms })
}

// SSE stream
export function streamTask(
  cfg: BluestacksConfig,
  sessionId: string,
  taskId: string,
  handlers: {
    onProgress?: (data: any) => void
    onAwaitInput?: (data: any) => void
    onCompleted?: (data: any) => void
    onClose?: () => void
    onError?: (err: any) => void
  }
) {
  const streamUrl = `${cfg.baseUrl}/v1/task/stream?session_id=${sessionId}&task_id=${taskId}`
  console.log('[SSE Stream] Opening stream:', streamUrl)
  
  const es = new EventSourcePolyfill(streamUrl, { heartbeatTimeout: 60_000 })
  
  // Log connection state changes
  es.onopen = () => {
    console.log('[SSE Stream] Connection opened for task:', taskId)
  }
  
  // Add event listeners with logging
  es.addEventListener('task_progress', (e: MessageEvent) => {
    console.log('[SSE Stream] Received task_progress event:', e.type, e.data?.substring(0, 100))
    try {
      const data = JSON.parse(e.data)
      handlers.onProgress?.(data)
    } catch (err) {
      console.error('[SSE Stream] Failed to parse task_progress data:', err, e.data)
    }
  })
  
  es.addEventListener('task_await_input', (e: MessageEvent) => {
    console.log('[SSE Stream] Received task_await_input event:', e.type)
    try {
      const data = JSON.parse(e.data)
      handlers.onAwaitInput?.(data)
    } catch (err) {
      console.error('[SSE Stream] Failed to parse task_await_input data:', err, e.data)
    }
  })
  
  es.addEventListener('task_completed', (e: MessageEvent) => {
    console.log('[SSE Stream] Received task_completed event:', e.type, e.data?.substring(0, 100))
    try {
      const data = JSON.parse(e.data)
      handlers.onCompleted?.(data)
    } catch (err) {
      console.error('[SSE Stream] Failed to parse task_completed data:', err, e.data)
    }
  })
  
  es.addEventListener('stream_closed', () => {
    console.log('[SSE Stream] Received stream_closed event')
    handlers.onClose?.()
    es.close()
  })
  
  // Listen to all message events for debugging
  es.addEventListener('message', (e: MessageEvent) => {
    console.log('[SSE Stream] Received generic message event:', e.type, e.data?.substring(0, 100))
  })
  
  es.onerror = (err: Event) => {
    console.error('[SSE Stream] Error event:', err, 'readyState:', (es as any).readyState)
    // readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
    const readyState = (es as any).readyState
    if (readyState === 2) { // CLOSED
      console.error('[SSE Stream] Connection closed unexpectedly')
    } else if (readyState === 0) { // CONNECTING
      console.warn('[SSE Stream] Connection error while connecting')
    }
    handlers.onError?.(err)
    es.close()
  }
  
  return () => {
    console.log('[SSE Stream] Closing stream for task:', taskId)
    es.close()
  }
}

// SNS Tasks (Instagram, etc.)
export async function likeLatestPost(
  cfg: BluestacksConfig,
  sessionId: string,
  options?: { baseUrl?: string }
) {
  // Use custom baseUrl if provided (e.g., http://localhost:8081), otherwise use cfg.baseUrl
  const baseUrl = options?.baseUrl || cfg.baseUrl
  return http<ToolResponse>(
    'POST',
    `${baseUrl}/v1/sns/ins/tasks/like_latest_post`,
    {
      session_id: sessionId,
    }
  )
}

// 如果需要直接连 AppPlayer 的 WS（通常不需要客户端主动调用）
export function connectAppPlayerWS(cfg: BluestacksConfig, sessionId: string) {
  const wsUrl = cfg.baseUrl.replace(/^http/, 'ws') + `/v1/appplayer/connect?session_id=${sessionId}`
  const ws = new WebSocket(wsUrl)
  return ws
}

