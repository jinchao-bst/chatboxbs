/**
 * SNS Task Handler - Integrates SNS Agent with Chatbox message system
 */

import type { SNSConfig } from './snsClient'
import * as snsClient from './snsClient'
import type { Message } from 'src/shared/types'

export interface SNSTaskOptions {
  sessionId: string
  userMessage: Message
  assistantMessage: Message
  onStepUpdate: (message: string, progress?: number) => Promise<void>
  onComplete: (finalMessage: string) => Promise<void>
  onError: (error: Error) => Promise<void>
  onCancelReady?: (cancelFn: () => void) => void
}

/**
 * Check if a message contains SNS automation task
 */
export function isSNSTask(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const taskKeywords = [
    '点赞',
    'like',
    '关注',
    'follow',
    '取消关注',
    'unfollow',
    'instagram',
    'ins',
    'sns',
    '帖子',
    'post',
    'reels',
  ]

  // Check if message contains task keywords
  return taskKeywords.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Extract username from message
 */
export function extractUsername(message: string): string | null {
  // Try to extract username from common patterns
  // e.g. "点赞 @username 的最新帖子" or "like username's latest post"
  const patterns = [
    /@(\w+)/, // @username
    /点赞\s+@?(\w+)/, // 点赞 @username
    /like\s+@?(\w+)/i, // like @username
    /给\s+@?(\w+)\s+点赞/, // 给 @username 点赞
    /(\w+)\s+的最新帖子/, // username 的最新帖子
    /(\w+)\s+latest\s+post/i, // username latest post
  ]

  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}

/**
 * Get SNS configuration from settings
 */
export function getSNSConfig(): SNSConfig {
  // For now, use default localhost
  // In production, read from settings store
  return {
    baseUrl: 'http://localhost:8080',
  }
}

/**
 * Handle SNS task execution
 */
export async function handleSNSTask(options: SNSTaskOptions): Promise<void> {
  const { sessionId, userMessage, assistantMessage, onStepUpdate, onComplete, onError, onCancelReady } = options

  let bluestacksSessionId: string | null = null
  let taskId: string | null = null
  let isCancelled = false
  let cancelFn: (() => void) | null = null

  try {
    const userText = getMessageText(userMessage)
    const cfg = getSNSConfig()

    // Check if server is reachable
    const serverReachable = await snsClient.pingSNSServer(cfg)
    if (!serverReachable) {
      throw new Error(
        'Failed to connect to SNS API server\n\n' +
        'Please ensure:\n' +
        '1. SNS API server is running (http://localhost:8080)\n' +
        '2. BlueStacks AI Agent Server is started\n' +
        '3. Network connection is normal'
      )
    }

    // Create or get BlueStacks session with auto-start support
    await onStepUpdate('Connecting to BlueStacks...')
    try {
      const { createSession, pingServer } = await import('../bluestacksClient')
      const bsConfig = { baseUrl: 'http://localhost:8080' }
      
      // Check if server is reachable, auto-start if needed
      let serverReachable = await pingServer(bsConfig)
      if (!serverReachable) {
        await onStepUpdate('Starting BlueStacks AI Agent Server...')
        try {
          // Try to start BlueStacksAI.exe via Electron IPC (only works in desktop app)
          const platform = await import('@/platform')
          if (platform.default.type === 'desktop' && platform.default.startBluestacksAI) {
            const startResult = await platform.default.startBluestacksAI()
            if (startResult.success) {
              // Wait a bit for server to start
              await new Promise((resolve) => setTimeout(resolve, 3000))
              // Check again
              serverReachable = await pingServer(bsConfig)
            }
          }
        } catch (startError) {
          console.warn('[SNS Agent] Failed to auto-start BlueStacksAI:', startError)
        }
        
        if (!serverReachable) {
          throw new Error(
            'Failed to connect to BlueStacks AI Agent Server\n\n' +
            'Please ensure:\n' +
            '1. BlueStacks AI Agent Server is running (http://localhost:8080)\n' +
            '2. Or manually start BlueStacksAI.exe\n' +
            '3. Network connection is normal'
          )
        }
      }
      
      // Create session with mode="agent" to auto-launch BlueStacks AppPlayer
      const sessionResult = await createSession(bsConfig, 'agent')
      if (sessionResult.status === 'success' && sessionResult.session_id) {
        bluestacksSessionId = sessionResult.session_id
      } else {
        throw new Error('Failed to create BlueStacks session')
      }
    } catch (error) {
      throw new Error(
        `Failed to connect to BlueStacks: ${error instanceof Error ? error.message : String(error)}\n\n` +
        'Please ensure BlueStacks AI Agent Server is running'
      )
    }

    // Detect task type and extract parameters
    const lowerText = userText.toLowerCase()
    const isLikeTask = lowerText.includes('点赞') || lowerText.includes('like')
    
    if (isLikeTask) {
      // Extract username for like task
      const username = extractUsername(userText)
      if (!username) {
        throw new Error('Please specify the username to like, e.g.: like @username or 点赞 @username')
      }

      await onStepUpdate(`Liking latest post for @${username}...`)

      // Call like_latest_post task endpoint
      const taskResult = await snsClient.likeLatestPostTask(cfg, bluestacksSessionId, username)
      
      if (taskResult.status !== 'success' || !taskResult.task_id) {
        throw new Error(taskResult.message || taskResult.error || 'Failed to start like task')
      }

      taskId = taskResult.task_id

      // Create cancel function
      cancelFn = async () => {
        isCancelled = true
        if (taskId) {
          try {
            await snsClient.cancelTask(cfg, taskId)
            await onStepUpdate('Task cancelled')
          } catch (error) {
            console.warn('[SNS Agent] Failed to cancel task:', error)
          }
        }
      }

      // Notify that cancel function is ready
      if (onCancelReady) {
        onCancelReady(cancelFn)
      }

      // Poll task status
      const maxPollAttempts = 300 // 5 minutes max (1 second intervals)
      let pollAttempts = 0

      while (pollAttempts < maxPollAttempts && !isCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait 1 second

        try {
          const statusResult = await snsClient.getTaskStatus(cfg, taskId)
          
          if (statusResult.task_status === 'completed') {
            const history = statusResult.history || []
            const lastStep = history[history.length - 1]
            const message = lastStep?.message || 'Successfully liked latest post'
            await onComplete(`✅ ${message}`)
            return
          } else if (statusResult.task_status === 'failed') {
            const history = statusResult.history || []
            const lastStep = history[history.length - 1]
            const errorMessage = lastStep?.message || statusResult.message || 'Task execution failed'
            throw new Error(errorMessage)
          } else if (statusResult.task_status === 'cancelled') {
            await onComplete('Task cancelled')
            return
          } else if (statusResult.task_status === 'running' || statusResult.task_status === 'pending') {
            // Update progress
            const progress = statusResult.progress || 0
            const history = statusResult.history || []
            const currentStep = history[history.length - 1]
            if (currentStep) {
              await onStepUpdate(`${currentStep.step || 'Executing'}...`, progress)
            }
          }
        } catch (error) {
          // If polling fails, continue trying (might be temporary network issue)
          console.warn('[SNS Agent] Task status polling error:', error)
        }

        pollAttempts++
      }

      // Timeout
      if (!isCancelled) {
        throw new Error('Task execution timeout, please try again later')
      }
    } else {
      // For other tasks, use action endpoint (backward compatibility)
      await onStepUpdate('Executing operation...')
      const result = await snsClient.likeLatestPost(cfg, bluestacksSessionId, '')
      
      if (result.status !== 'success' || !result.success) {
        throw new Error(result.message || result.error || 'Operation failed')
      }
      
      await onComplete(`✅ ${result.message || 'Operation completed'}`)
    }
  } catch (error) {
    if (!isCancelled) {
      await onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * Helper function to get message text
 */
function getMessageText(message: Message): string {
  if (Array.isArray(message.contentParts)) {
    return message.contentParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  if (typeof (message as any).content === 'string') {
    return (message as any).content
  }
  return ''
}

