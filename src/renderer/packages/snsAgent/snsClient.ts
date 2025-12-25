/**
 * SNS Client - HTTP client for SNS API
 */

export type SNSConfig = {
  baseUrl: string // e.g. http://localhost:8080
}

export type SNSResponse<T = any> = {
  status: 'success' | 'failure'
  message?: string
  success?: boolean
  data?: T
  error?: string
  task_id?: string
}

/**
 * Check if SNS API server is reachable
 */
export async function pingSNSServer(cfg: SNSConfig): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/sns/ins/actions`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    })
    return res.ok
  } catch (error) {
    return false
  }
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
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const urlObj = new URL(url)
      throw new Error(
        `Failed to connect to SNS API server (${urlObj.host})\n\n` +
        `Please ensure:\n` +
        `1. SNS API server is running\n` +
        `2. Server address is correct: ${urlObj.origin}\n` +
        `3. Firewall allows connection`
      )
    }
    throw error
  }
}

/**
 * Like latest post task (complete task with username)
 * 
 * This is a TASK endpoint that:
 * - Searches for the user
 * - Opens their profile
 * - Opens their first post
 * - Likes the post
 * - Returns a task_id for status polling
 * 
 * @param cfg - SNS configuration
 * @param sessionId - BlueStacks session ID
 * @param username - Username whose latest post to like
 * @param options - Optional base URL override
 * @returns Task response with task_id
 */
export async function likeLatestPostTask(
  cfg: SNSConfig,
  sessionId: string,
  username: string,
  options?: { baseUrl?: string }
): Promise<SNSResponse & { task_id?: string }> {
  const baseUrl = options?.baseUrl || cfg.baseUrl
  return http<SNSResponse & { task_id?: string }>(
    'POST',
    `${baseUrl}/v1/sns/ins/tasks/like_latest_post`,
    {
      session_id: sessionId,
      username: username,
    }
  )
}

/**
 * Ensure the current post is liked (action_ensure_post_liked)
 * 
 * Note: This is an ACTION endpoint, not a TASK endpoint.
 * - It requires the user to already be on a post page
 * - It does NOT search for a user or open a post
 * - It only ensures the current visible post is liked
 * - It does NOT return a task_id (actions execute immediately)
 * 
 * @param cfg - SNS configuration
 * @param sessionId - BlueStacks session ID
 * @param username - Username (ignored, kept for backward compatibility)
 * @param options - Optional base URL override
 * @returns Action response (no task_id)
 */
export async function likeLatestPost(
  cfg: SNSConfig,
  sessionId: string,
  username: string,
  options?: { baseUrl?: string }
): Promise<SNSResponse> {
  const baseUrl = options?.baseUrl || cfg.baseUrl
  return http<SNSResponse>(
    'POST',
    `${baseUrl}/v1/sns/ins/actions/ensure_post_liked`,
    {
      session_id: sessionId,
    }
  )
}

/**
 * Get task status
 */
export async function getTaskStatus(
  cfg: SNSConfig,
  taskId: string,
  options?: { baseUrl?: string }
): Promise<SNSResponse & { task_status?: string; progress?: number; history?: any[] }> {
  const baseUrl = options?.baseUrl || cfg.baseUrl
  return http<SNSResponse & { task_status?: string; progress?: number; history?: any[] }>(
    'GET',
    `${baseUrl}/v1/sns/ins/tasks/${taskId}/status`
  )
}

/**
 * Cancel a task
 */
export async function cancelTask(
  cfg: SNSConfig,
  taskId: string,
  options?: { baseUrl?: string }
): Promise<SNSResponse> {
  const baseUrl = options?.baseUrl || cfg.baseUrl
  return http<SNSResponse>(
    'POST',
    `${baseUrl}/v1/sns/ins/tasks/${taskId}/cancel`
  )
}

