/**
 * BlueStacks Chat Assistant Handler
 * 
 * Handles chat completion using BlueStacks LLM API
 */

import type { Message } from 'src/shared/types'
import * as bsClient from '../bluestacksClient'
import type { BluestacksConfig } from '../bluestacksClient'

export interface ChatAssistantOptions {
  sessionId: string
  userMessage: Message
  assistantMessage: Message
  onUpdate: (message: string) => Promise<void>
  onComplete: (finalMessage: string) => Promise<void>
  onError: (error: Error) => Promise<void>
  onCancelReady?: (cancelFn: () => void) => void
}

/**
 * Get BlueStacks configuration
 */
export function getBluestacksConfig(): BluestacksConfig {
  return {
    baseUrl: 'http://localhost:8080',
  }
}

/**
 * Get message text from Message object
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


/**
 * Handle chat assistant conversation using BlueStacks LLM
 */
export async function handleChatAssistant(options: ChatAssistantOptions): Promise<void> {
  const { sessionId, userMessage, assistantMessage, onUpdate, onComplete, onError, onCancelReady } = options
  
  let bluestacksSessionId: string | null = null
  let taskId: string | null = null
  let isCancelled = false
  let cancelFn: (() => void) | null = null

  try {
    const cfg = getBluestacksConfig()
    
    // Check if server is reachable
    const serverReachable = await bsClient.pingServer(cfg)
    if (!serverReachable) {
      throw new Error(
        'Failed to connect to BlueStacks AI Agent Server\n\n' +
        'Please ensure:\n' +
        '1. BlueStacks AI Agent Server is running (http://localhost:8080)\n' +
        '2. Or manually start BlueStacksAI.exe\n' +
        '3. Network connection is normal'
      )
    }

    // Create or get BlueStacks session with auto-start support
    await onUpdate('Connecting to BlueStacks...')
    try {
      const { createSession, pingServer } = await import('../bluestacksClient')
      const bsConfig = { baseUrl: 'http://localhost:8080' }
      
      // Check if server is reachable, auto-start if needed
      let serverReachable = await pingServer(bsConfig)
      if (!serverReachable) {
        await onUpdate('Starting BlueStacks AI Agent Server...')
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
          console.warn('[Chat Assistant] Failed to auto-start BlueStacksAI:', startError)
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
      // Note: mode="agent" will automatically launch BlueStacks AppPlayer and wait for WebSocket connection
      await onUpdate('Creating BlueStacks session (will auto-start AppPlayer)...')
      const sessionResult = await createSession(bsConfig, 'agent')
      if (sessionResult.status === 'success' && sessionResult.session_id) {
        bluestacksSessionId = sessionResult.session_id
        await onUpdate('Session created, waiting for BlueStacks AppPlayer to connect (up to 30 seconds)...')
        
        // Wait a bit for WebSocket connection to be established
        // The Agent Server waits up to 30 seconds for AppPlayer to connect
        // We wait a bit here to give AppPlayer time to start and connect
        await new Promise((resolve) => setTimeout(resolve, 3000))
      } else {
        throw new Error(
          `Failed to create BlueStacks session\n\n` +
          `Error: ${(sessionResult as any).error || (sessionResult as any).message || 'Unknown error'}\n\n` +
          `Please ensure:\n` +
          `1. BlueStacks AI Agent Server is running\n` +
          `2. BlueStacks AppPlayer can start normally`
        )
      }
    } catch (error) {
      throw new Error(
        `Failed to connect to BlueStacks: ${error instanceof Error ? error.message : String(error)}\n\n` +
        'Please ensure BlueStacks AI Agent Server is running'
      )
    }

    // Get session messages for context
    const { getSession } = await import('@/stores/chatStore')
    const session = await getSession(sessionId)
    const allMessages = session?.messages || []
    
    // Get the latest user message
    const userText = getMessageText(userMessage)
    if (!userText) {
      throw new Error('No available message content')
    }

    // Build conversation context from previous messages
    // Take last few messages for context (to avoid too long context)
    const recentMessages = allMessages.slice(-10) // Last 10 messages
    let conversationContext = ''
    
    for (const msg of recentMessages) {
      const text = getMessageText(msg)
      if (!text) continue
      
      if (msg.role === 'system') {
        conversationContext += `[System Prompt] ${text}\n\n`
      } else if (msg.role === 'user') {
        conversationContext += `User: ${text}\n\n`
      } else if (msg.role === 'assistant') {
        conversationContext += `Assistant: ${text}\n\n`
      }
    }
    
    // Build the query with context
    const query = conversationContext 
      ? `${conversationContext}User: ${userText}\n\nPlease respond to the user's question as an AI assistant.`
      : userText

    // Get LLM configuration from session settings
    const { settingsStore } = await import('@/stores/settingsStore')
    const { ModelProviderEnum } = await import('src/shared/types')
    const globalSettings = settingsStore.getState().getSettings()
    const sessionSettings = session?.settings || {}
    
    // Map Chatbox provider names to BlueStacks provider names
    // BlueStacks AppPlayer only recognizes: "GoogleGenAI", "Anthropic", "OpenAI"
    // Chatbox uses "Gemini" but BlueStacks needs "GoogleGenAI"
    function mapProviderToBlueStacks(chatboxProvider: string): string {
      // Gemini -> GoogleGenAI
      if (chatboxProvider === ModelProviderEnum.Gemini || chatboxProvider === 'Gemini' || chatboxProvider === 'google-genai') {
        return 'GoogleGenAI'
      }
      // OpenAI -> OpenAI (same)
      if (chatboxProvider === ModelProviderEnum.OpenAI || chatboxProvider === 'OpenAI') {
        return 'OpenAI'
      }
      // Claude -> Anthropic
      if (chatboxProvider === ModelProviderEnum.Claude || chatboxProvider === 'Claude' || chatboxProvider === 'claude') {
        return 'Anthropic'
      }
      // Default to GoogleGenAI
      return 'GoogleGenAI'
    }
    
    const chatboxProvider = sessionSettings.provider || ModelProviderEnum.Gemini
    const bluestacksProvider = mapProviderToBlueStacks(chatboxProvider)
    
    // Default LLM config (use accessibility for chat, but no vision/screenshots)
    const llmConfig = {
      provider: bluestacksProvider,
      model: sessionSettings.modelId || 'gemini-2.5-pro',
      temperature: sessionSettings.temperature ?? 0.7,
      max_tokens: sessionSettings.maxTokens,
      max_steps: 1, // Only one step for chat (no automation)
      timeout: 60, // 60 seconds timeout
      vision: false, // Disable vision for chat (no screenshots)
      accessibility: true, // Enable accessibility (required by API, but won't be used for chat)
    }

    await onUpdate('Generating response...')

    // Create cancel function (will be updated after task is created)
    cancelFn = () => {
      isCancelled = true
    }

    // Notify that cancel function is ready
    if (onCancelReady) {
      onCancelReady(cancelFn)
    }

    // Create a task using BlueStacks task API (this will use LLM to generate response)
    let taskResult: { status: string; task_id?: string; error?: string; message?: string }
    try {
      taskResult = await bsClient.createTask(cfg, bluestacksSessionId!, query, llmConfig) as any
    } catch (error: any) {
      // Handle specific error cases
      if (error?.error === 'llm_api_key_not_found' || error?.message?.includes('llm_api_key_not_found')) {
        const provider = llmConfig.provider || 'GoogleGenAI'
        const model = llmConfig.model || 'gemini-2.5-pro'
        throw new Error(
          `LLM API Key not found\n\n` +
          `BlueStacks AI Agent Server requires an LLM API Key to execute tasks.\n\n` +
          `Current model: ${provider} / ${model}\n\n` +
          `Solution:\n` +
          `1. Ensure BlueStacks AppPlayer is started and connected to Agent Server\n` +
          `   (Creating session with mode="agent" will auto-start AppPlayer, please wait a few seconds)\n` +
          `2. Configure API Key in BlueStacks AppPlayer:\n` +
          `   - Open BlueStacks AppPlayer\n` +
          `   - Go to Settings → AI Agent Settings\n` +
          `   - Configure ${provider} API Key\n\n` +
          `3. Ensure BlueStacks AppPlayer is connected to Agent Server via WebSocket\n` +
          `   (If AppPlayer is started but not connected, please restart AppPlayer)\n\n` +
          `Original error: ${error?.message || String(error)}`
        )
      }
      throw error
    }
    
    if (taskResult.status !== 'success' || !taskResult.task_id) {
      const errorMsg = (taskResult as any).error || (taskResult as any).message || 'Failed to create task'
      
      // Check for specific error types
      if ((taskResult as any).error === 'llm_api_key_not_found') {
        const provider = llmConfig.provider || 'GoogleGenAI'
        const model = llmConfig.model || 'gemini-2.5-pro'
        throw new Error(
          `LLM API Key not found\n\n` +
          `BlueStacks AI Agent Server requires an LLM API Key to execute tasks.\n\n` +
          `Current model: ${provider} / ${model}\n\n` +
          `Solution:\n` +
          `1. Ensure BlueStacks AppPlayer is started and connected to Agent Server\n` +
          `   (Creating session with mode="agent" will auto-start AppPlayer, please wait a few seconds)\n` +
          `2. Configure API Key in BlueStacks AppPlayer:\n` +
          `   - Open BlueStacks AppPlayer\n` +
          `   - Go to Settings → AI Agent Settings\n` +
          `   - Configure ${provider} API Key\n\n` +
          `3. Ensure BlueStacks AppPlayer is connected to Agent Server via WebSocket\n` +
          `   (If AppPlayer is started but not connected, please restart AppPlayer)\n\n` +
          `Original error: ${errorMsg}`
        )
      }
      
      throw new Error(errorMsg)
    }
    
    const currentTaskId = taskResult.task_id
    taskId = currentTaskId

    // Use SSE stream to get real-time responses
    return new Promise<void>((resolve, reject) => {
      let lastAssistantMessage = ''
      let hasCompleted = false
      let streamStarted = false
      let timeoutId: NodeJS.Timeout | null = null
      let connectionTimeoutId: NodeJS.Timeout | null = null

      // Set a timeout for the entire operation (60 seconds)
      timeoutId = setTimeout(() => {
        if (!hasCompleted) {
          hasCompleted = true
          closeStream()
          if (!isCancelled) {
            onError(new Error('Task execution timeout (60 seconds), please check task status or retry')).catch(console.error)
            reject(new Error('Task execution timeout'))
          }
        }
      }, 60000)

      // Set a timeout for initial connection (10 seconds)
      // If no events are received within 10 seconds, check task status as fallback
      connectionTimeoutId = setTimeout(() => {
        if (!streamStarted && !hasCompleted) {
          console.warn('[Chat Assistant] No SSE events received within 10 seconds, checking task status...')
          // Check task status as fallback
          bsClient.taskStatus(cfg, bluestacksSessionId!, currentTaskId)
            .then((status) => {
              console.log('[Chat Assistant] Task status:', status)
              if (status.state === 'failed') {
                hasCompleted = true
                closeStream()
                const errorMsg = status.result?.error || status.result?.message || 'Task execution failed'
                onError(new Error(errorMsg)).catch(console.error)
                reject(new Error(errorMsg))
              } else if (status.state === 'completed') {
                hasCompleted = true
                closeStream()
                const output = status.result?.output || status.result?.message || '任务已完成'
                onComplete(output).catch(console.error)
                resolve()
              }
            })
            .catch((err) => {
              console.error('[Chat Assistant] Failed to get task status:', err)
            })
        }
      }, 10000)

      const closeStream = bsClient.streamTask(cfg, bluestacksSessionId!, currentTaskId, {
        onProgress: (data) => {
          console.log('[Chat Assistant] onProgress called:', data)
          streamStarted = true
          if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId)
            connectionTimeoutId = null
          }
          
          if (isCancelled) {
            closeStream()
            return
          }
          
          // Extract LLM response from stream
          const responses = data.responses || []
          console.log('[Chat Assistant] Progress responses count:', responses.length)
          for (let i = responses.length - 1; i >= 0; i--) {
            const response = responses[i]
            if (response.type === 'llm_response' && response.message) {
              lastAssistantMessage = response.message
              console.log('[Chat Assistant] Found LLM response:', response.message.substring(0, 100))
              onUpdate(response.message).catch(console.error)
              break
            }
          }
          
          // Also check delta for new responses
          if (data.delta) {
            console.log('[Chat Assistant] Progress delta:', data.delta)
            if (data.delta.type === 'llm_response' && data.delta.message) {
              lastAssistantMessage = data.delta.message
              console.log('[Chat Assistant] Found LLM response in delta:', data.delta.message.substring(0, 100))
              onUpdate(data.delta.message).catch(console.error)
            }
          }
        },
        onCompleted: async (data) => {
          console.log('[Chat Assistant] onCompleted called:', data)
          if (hasCompleted) return
          hasCompleted = true
          
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId)
            connectionTimeoutId = null
          }
          
          closeStream()
          
          if (isCancelled) {
            await onComplete('Conversation cancelled')
            resolve()
            return
          }
          
          // Extract final response
          let finalResponse = lastAssistantMessage
          
          // Try to get from result
          if (data.result) {
            if (data.result.status === 'failure') {
              const errorMsg = data.result.error || data.result.message || 'Task execution failed'
              await onError(new Error(errorMsg))
              reject(new Error(errorMsg))
              return
            }
            
            if (data.result.output) {
              finalResponse = data.result.output
            } else if (data.result.message) {
              finalResponse = data.result.message
            }
          }
          
          // Try to get from chat history in responses
          if (!finalResponse) {
            const responses = data.responses || []
            for (let i = responses.length - 1; i >= 0; i--) {
              const response = responses[i]
              if (response.type === 'llm_response' && response.message) {
                finalResponse = response.message
                break
              }
            }
          }
          
          if (!finalResponse) {
            finalResponse = 'Response generated but unable to extract content'
          }
          
          await onComplete(finalResponse)
          resolve()
        },
        onError: async (err) => {
          console.error('[Chat Assistant] onError called:', err)
          if (hasCompleted) return
          hasCompleted = true
          
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId)
            connectionTimeoutId = null
          }
          
          // Clear polling interval if exists
          if (pollingInterval) {
            clearInterval(pollingInterval)
            pollingInterval = null
          }
          
          closeStream()
          
          if (!isCancelled) {
            console.error('[Chat Assistant] SSE stream error:', err)
            // Try to get task status as fallback
            try {
              const status = await bsClient.taskStatus(cfg, bluestacksSessionId!, currentTaskId)
              if (status.state === 'failed') {
                const errorMsg = status.result?.error || status.result?.message || 'Task execution failed'
                await onError(new Error(errorMsg))
                reject(new Error(errorMsg))
              } else {
                await onError(new Error(`Stream response error: ${err}`))
                reject(err)
              }
            } catch (statusError) {
                await onError(new Error(`Stream response error: ${err}`))
              reject(err)
            }
          }
        },
        onClose: () => {
          console.log('[Chat Assistant] onClose called, hasCompleted:', hasCompleted, 'isCancelled:', isCancelled)
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (connectionTimeoutId) {
            clearTimeout(connectionTimeoutId)
            connectionTimeoutId = null
          }
          
          // Clear polling interval if exists
          if (pollingInterval) {
            clearInterval(pollingInterval)
            pollingInterval = null
          }
          
          // If stream closed without completion, check task status
          if (!hasCompleted && !isCancelled) {
            console.warn('[Chat Assistant] SSE stream closed unexpectedly, checking task status...')
            bsClient.taskStatus(cfg, bluestacksSessionId!, currentTaskId)
              .then((status) => {
                if (status.state === 'completed') {
                  hasCompleted = true
                  const output = status.result?.output || status.result?.message || 'Task completed'
                  onComplete(output).catch(console.error)
                  resolve()
                } else if (status.state === 'failed') {
                  hasCompleted = true
                  const errorMsg = status.result?.error || status.result?.message || 'Task execution failed'
                  onError(new Error(errorMsg)).catch(console.error)
                  reject(new Error(errorMsg))
                }
              })
              .catch((err) => {
                console.error('[Chat Assistant] Failed to get task status after stream close:', err)
                if (!hasCompleted) {
                  hasCompleted = true
                  onError(new Error('Stream closed, unable to get task status')).catch(console.error)
                  reject(new Error('Stream closed'))
                }
              })
          }
        },
      })

      // Update cancel function to also close stream
      const originalCancelFn = cancelFn
      cancelFn = () => {
        isCancelled = true
        
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        if (connectionTimeoutId) {
          clearTimeout(connectionTimeoutId)
          connectionTimeoutId = null
        }
        
        closeStream()
        if (originalCancelFn) {
          originalCancelFn()
        }
        if (currentTaskId && bluestacksSessionId) {
          bsClient.stopTask(cfg, bluestacksSessionId, currentTaskId).catch(console.error)
        }
      }
      
      if (onCancelReady) {
        onCancelReady(cancelFn)
      }
    })
  } catch (error) {
    if (!isCancelled) {
      await onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

