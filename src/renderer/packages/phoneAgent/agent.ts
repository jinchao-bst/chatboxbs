/**
 * PhoneAgent - AI-powered phone automation agent
 * TypeScript implementation of the phone agent workflow
 */

import type { BluestacksConfig } from '../bluestacksClient'
import * as bsClient from '../bluestacksClient'
import { ActionHandler, parseAction, type ActionResult } from './actionHandler'
import * as bsOps from './bluestacks'
import type { Message } from 'src/shared/types'

export interface AgentConfig {
  maxSteps?: number
  instanceId?: string
  lang?: 'cn' | 'en'
  systemPrompt?: string
  verbose?: boolean
  useChatboxModel?: boolean // If true, use Chatbox's model instead of Agent Server's LLM
  chatboxModel?: any // Chatbox model instance (ModelInterface)
  chatboxSettings?: any // Session settings for Chatbox model
  chatboxGlobalSettings?: any // Global settings for Chatbox model
}

export interface StepResult {
  success: boolean
  finished: boolean
  action?: any
  thinking?: string
  message?: string
  screenshot?: { base64Data: string; width: number; height: number }
}

export interface ModelResponse {
  thinking: string
  action: string
  rawContent: string
}

export type ConfirmationCallback = (message: string) => Promise<boolean>
export type TakeoverCallback = (message: string) => Promise<void>
export type OnStepResult = (result: StepResult) => void

/**
 * PhoneAgent - Main agent class for orchestrating phone automation
 */
export class PhoneAgent {
  private cfg: BluestacksConfig
  private agentConfig: Required<Omit<AgentConfig, 'instanceId' | 'useChatboxModel' | 'chatboxModel' | 'chatboxSettings' | 'chatboxGlobalSettings'>> & 
    { instanceId?: string; useChatboxModel?: boolean; chatboxModel?: any; chatboxSettings?: any; chatboxGlobalSettings?: any }
  private sessionId?: string
  private taskId?: string
  private actionHandler?: ActionHandler
  private stepCount = 0
  private context: Message[] = []
  private onStepResultCallback?: OnStepResult
  private confirmationCallback?: ConfirmationCallback
  private takeoverCallback?: TakeoverCallback
  private isStopped = false
  private abortController?: AbortController

  constructor(
    cfg: BluestacksConfig,
    agentConfig: AgentConfig = {},
    callbacks?: {
      onStepResult?: OnStepResult
      confirmationCallback?: ConfirmationCallback
      takeoverCallback?: TakeoverCallback
    }
  ) {
    this.cfg = cfg
    this.agentConfig = {
      maxSteps: agentConfig.maxSteps ?? 100,
      instanceId: agentConfig.instanceId ?? undefined,
      lang: agentConfig.lang ?? 'cn',
      systemPrompt: agentConfig.systemPrompt ?? this.getDefaultSystemPrompt(agentConfig.lang ?? 'cn'),
      verbose: agentConfig.verbose ?? true,
      useChatboxModel: agentConfig.useChatboxModel ?? false,
      chatboxModel: agentConfig.chatboxModel,
      chatboxSettings: agentConfig.chatboxSettings,
      chatboxGlobalSettings: agentConfig.chatboxGlobalSettings,
    }
    this.onStepResultCallback = callbacks?.onStepResult
    this.confirmationCallback = callbacks?.confirmationCallback
    this.takeoverCallback = callbacks?.takeoverCallback
  }

  /**
   * Initialize session with BlueStacks
   * 
   * When mode="agent", the Agent Server will automatically:
   * 1. Launch BlueStacks if not running
   * 2. Wait for WebSocket connection (up to 30 seconds)
   * 
   * @throws Error if session creation fails or connection timeout
   */
  async initialize(): Promise<void> {
    if (this.sessionId) {
      return // Already initialized
    }

    try {
      // First, check if server is reachable
      if (this.agentConfig.verbose) {
        console.log(`[PhoneAgent] Checking server connection: ${this.cfg.baseUrl}`)
      }
      
      let serverReachable = await bsClient.pingServer(this.cfg)
      
      // If server is not reachable, try to start it automatically
      if (!serverReachable) {
        if (this.agentConfig.verbose) {
          console.log(`[PhoneAgent] Server not reachable, attempting to start BlueStacksAI.exe...`)
        }
        
        try {
          // Try to start BlueStacksAI.exe via Electron IPC (only works in desktop app)
          const platform = await import('@/platform').then((m) => m.default)
          if (platform.type === 'desktop' && platform.startBluestacksAI) {
            const startResult = await platform.startBluestacksAI()
            if (startResult.success) {
              if (this.agentConfig.verbose) {
                console.log(`[PhoneAgent] ${startResult.message}, waiting for server to start...`)
              }
              // Wait for server to start (up to 10 seconds)
              for (let i = 0; i < 10; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
                serverReachable = await bsClient.pingServer(this.cfg)
                if (serverReachable) {
                  if (this.agentConfig.verbose) {
                    console.log(`[PhoneAgent] Server is now reachable after ${i + 1} seconds`)
                  }
                  break
                }
              }
            } else {
              if (this.agentConfig.verbose) {
                console.warn(`[PhoneAgent] Failed to start: ${startResult.message}`)
              }
            }
          }
        } catch (error) {
          if (this.agentConfig.verbose) {
            console.warn(`[PhoneAgent] Auto-start failed:`, error)
          }
        }
      }
      
      // Final check
      if (!serverReachable) {
        throw new Error(
          `无法连接到 BlueStacks AI Agent Server\n\n` +
          `服务器地址: ${this.cfg.baseUrl}\n\n` +
          `请确保：\n` +
          `1. BlueStacks AI Agent Server 正在运行\n` +
          `2. 服务器地址正确\n` +
          `3. 防火墙未阻止连接\n\n` +
          `如何启动服务器：\n` +
          `- Windows: 运行 BlueStacksAI.exe\n` +
          `- 或访问 http://localhost:8080/info 检查服务器状态`
        )
      }

      if (this.agentConfig.verbose) {
        console.log(`[PhoneAgent] Server is reachable, creating session...`)
      }

      // Create session with mode="agent" to enable auto-launch
      const result = await bsClient.createSession(this.cfg, 'agent', this.agentConfig.instanceId)
      
      // Check for errors
      if (result.status === 'failure') {
        const error = result.error || 'session_creation_failed'
        const message = result.message || 'Unknown error'
        
        // Provide user-friendly error messages
        if (error === 'bluestacks_connection_failed') {
          throw new Error(
            `无法连接到 BlueStacks。请确保：\n` +
            `1. BlueStacks 已安装\n` +
            `2. BlueStacks AI Agent Server 正在运行\n` +
            `3. 等待 BlueStacks 完全启动后重试\n` +
            `错误详情: ${message}`
          )
        }
        
        throw new Error(`Session creation failed: ${error} - ${message}`)
      }
      
      if (!result.session_id) {
        throw new Error('Failed to create session: no session_id returned')
      }
      
      this.sessionId = result.session_id
      
      if (this.agentConfig.verbose) {
        console.log(`[PhoneAgent] Session created: ${this.sessionId}`)
        console.log(`[PhoneAgent] BlueStacks should be launching automatically...`)
      }

      this.actionHandler = new ActionHandler(
        this.cfg,
        this.sessionId,
        this.confirmationCallback,
        this.takeoverCallback
      )
    } catch (error) {
      if (this.agentConfig.verbose) {
        console.error('[PhoneAgent] Session initialization failed:', error)
      }
      throw error
    }
  }

  /**
   * Run the agent to complete a task
   */
  async run(task: string, llmConfig?: any): Promise<string> {
    await this.initialize()
    this.reset()
    this.isStopped = false

    // First step with user prompt
    let result = await this.executeStep(task, true, llmConfig)

    if (this.isStopped) {
      return 'Task stopped by user'
    }

    if (result.finished) {
      return result.message || 'Task completed'
    }

    // Continue until finished or max steps reached
    while (this.stepCount < this.agentConfig.maxSteps && !this.isStopped) {
      result = await this.executeStep(undefined, false, llmConfig)

      if (this.isStopped) {
        return 'Task stopped by user'
      }

      if (result.finished) {
        return result.message || 'Task completed'
      }
    }

    if (this.isStopped) {
      return 'Task stopped by user'
    }

    return 'Max steps reached'
  }

  /**
   * Stop the agent execution
   */
  stop(): void {
    if (this.agentConfig.verbose) {
      console.log('[PhoneAgent] Stopping agent execution...')
    }
    this.isStopped = true
    
    // Abort any ongoing model calls
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }

    // Stop task on server if taskId exists
    if (this.taskId && this.sessionId) {
      bsClient.stopTask(this.cfg, this.sessionId, this.taskId).catch((error) => {
        console.error('[PhoneAgent] Error stopping task on server:', error)
      })
    }
  }

  /**
   * Execute a single step (useful for manual control)
   */
  async step(task?: string, llmConfig?: any): Promise<StepResult> {
    await this.initialize()
    const isFirst = this.context.length === 0

    if (isFirst && !task) {
      throw new Error('Task is required for the first step')
    }

    return this.executeStep(task, isFirst, llmConfig)
  }

  /**
   * Reset agent state
   */
  reset(): void {
    this.context = []
    this.stepCount = 0
    this.taskId = undefined
  }

  /**
   * Close session and cleanup
   */
  async close(): Promise<void> {
    if (this.sessionId) {
      try {
        await bsClient.closeSession(this.cfg, this.sessionId)
      } catch (error) {
        console.error('Error closing session:', error)
      }
      this.sessionId = undefined
    }
  }

  /**
   * Get current context
   */
  getContext(): Message[] {
    return [...this.context]
  }

  /**
   * Get step count
   */
  getStepCount(): number {
    return this.stepCount
  }

  /**
   * Get session ID (for external access)
   */
  getSessionId(): string | undefined {
    return this.sessionId
  }

  /**
   * Execute a single step of the agent loop
   */
  private async executeStep(userPrompt?: string, isFirst: boolean = false, llmConfig?: any): Promise<StepResult> {
    if (!this.sessionId || !this.actionHandler) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }

    // Check if stopped before executing step
    if (this.isStopped) {
      return {
        success: false,
        finished: true,
        message: 'Task stopped by user',
      }
    }

    this.stepCount++

    // Capture current screen state
    const screenshot = await bsOps.getScreenshot(this.cfg, this.sessionId)
    const currentApp = await bsOps.getCurrentApp(this.cfg, this.sessionId)

    // Build messages for model
    if (isFirst) {
      // Add system message
      this.context.push({
        id: `system-${Date.now()}`,
        role: 'system',
        contentParts: [
          {
            type: 'text',
            text: this.agentConfig.systemPrompt,
          },
        ],
      })

      // Add user message with task and screen info
      const screenInfo = this.buildScreenInfo(currentApp)
      const textContent = `${userPrompt}\n\n${screenInfo}`

      this.context.push({
        id: `user-${Date.now()}`,
        role: 'user',
        contentParts: [
          {
            type: 'text',
            text: textContent,
          },
          {
            type: 'image',
            storageKey: `screenshot-${Date.now()}`,
            // Store base64 in a way that can be used by model
            // Note: You might need to adjust this based on how Chatbox handles images
          },
        ],
      })

      // Create task via BlueStacks agent server
      if (llmConfig) {
        const taskResult = await bsClient.createTask(this.cfg, this.sessionId, userPrompt || '', llmConfig)
        this.taskId = taskResult.task_id
      }
    } else {
      // Add screen update message
      const screenInfo = this.buildScreenInfo(currentApp)
      const textContent = `** Screen Info **\n\n${screenInfo}`

      // Save screenshot to storage if using Chatbox model
      let screenshotStorageKey: string | undefined
      if (this.agentConfig.useChatboxModel) {
        const { saveScreenshotToStorage } = await import('./bluestacksTaskHandler')
        screenshotStorageKey = await saveScreenshotToStorage(screenshot.base64Data)
      }

      this.context.push({
        id: `user-${Date.now()}`,
        role: 'user',
        contentParts: [
          {
            type: 'text',
            text: textContent,
          },
          ...(screenshotStorageKey
            ? [
                {
                  type: 'image' as const,
                  storageKey: screenshotStorageKey,
                },
              ]
            : [
                {
                  type: 'image' as const,
                  storageKey: `screenshot-${Date.now()}`,
                },
              ]),
        ],
      })
    }

    // Check if stopped before getting model response
    if (this.isStopped) {
      return {
        success: false,
        finished: true,
        message: 'Task stopped by user',
      }
    }

    // Get model response
    let response: ModelResponse
    try {
      if (this.agentConfig.useChatboxModel && this.agentConfig.chatboxModel) {
        // Use Chatbox's model directly
        response = await this.getModelResponseFromChatbox(screenshot)
      } else if (this.taskId && llmConfig) {
        // Use BlueStacks agent server task streaming
        response = await this.getModelResponseFromTask()
      } else {
        // Fallback: would need to call Chatbox's model directly
        // For now, throw error to indicate this needs implementation
        throw new Error('Model response not implemented. Use Chatbox model or BlueStacks agent server with llmConfig.')
      }
    } catch (error) {
      // Check if error is due to abort
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          finished: true,
          message: 'Task stopped by user',
        }
      }
      if (this.agentConfig.verbose) {
        console.error('Model error:', error)
      }
      return {
        success: false,
        finished: true,
        thinking: '',
        message: `Model error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Check if stopped after getting model response
    if (this.isStopped) {
      return {
        success: false,
        finished: true,
        message: 'Task stopped by user',
      }
    }

    // Parse action from response
    let action: any
    try {
      action = parseAction(response.action)
    } catch (error) {
      if (this.agentConfig.verbose) {
        console.error('Parse action error:', error)
      }
      // Treat as finish action
      action = {
        _metadata: 'finish',
        message: response.action,
      }
    }

    if (this.agentConfig.verbose) {
      console.log('\n' + '='.repeat(50))
      console.log('💭 Thinking:')
      console.log('-'.repeat(50))
      console.log(response.thinking)
      console.log('-'.repeat(50))
      console.log('🎯 Action:')
      console.log(JSON.stringify(action, null, 2))
      console.log('='.repeat(50) + '\n')
    }

    // Remove image from context to save space (keep only text)
    if (this.context.length > 0) {
      const lastMsg = this.context[this.context.length - 1]
      if (lastMsg.contentParts) {
        lastMsg.contentParts = lastMsg.contentParts.filter((p) => p.type !== 'image')
      }
    }

    // Check if stopped before executing action
    if (this.isStopped) {
      return {
        success: false,
        finished: true,
        message: 'Task stopped by user',
      }
    }

    // Execute action
    let result: ActionResult
    try {
      result = await this.actionHandler.execute(action, screenshot.width, screenshot.height)
    } catch (error) {
      if (this.agentConfig.verbose) {
        console.error('Action execution error:', error)
      }
      result = await this.actionHandler.execute(
        {
          _metadata: 'finish',
          message: error instanceof Error ? error.message : String(error),
        },
        screenshot.width,
        screenshot.height
      )
    }

    // Check if stopped after executing action
    if (this.isStopped) {
      return {
        success: false,
        finished: true,
        message: 'Task stopped by user',
      }
    }

    // Add assistant response to context
    this.context.push({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      contentParts: [
        {
          type: 'text',
          text: `<think>${response.thinking}</think><answer>${response.action}</answer>`,
        },
      ],
    })

    // Check if finished
    const finished = action._metadata === 'finish' || result.shouldFinish

    if (finished && this.agentConfig.verbose) {
      console.log('\n' + '🎉 ' + '='.repeat(48))
      console.log(`✅ Task completed: ${result.message || action.message || 'Done'}`)
      console.log('='.repeat(50) + '\n')
    }

    const stepResult: StepResult = {
      success: result.success,
      finished,
      action,
      thinking: response.thinking,
      message: result.message || action.message,
      screenshot: screenshot, // Include screenshot in step result to avoid duplicate calls
    }

    // Debug logging for step result
    if (this.agentConfig.verbose) {
      console.log(`[PhoneAgent] Step ${this.stepCount} result:`, {
        thinking: stepResult.thinking ? `${stepResult.thinking.substring(0, 100)}...` : '(empty)',
        thinkingLength: stepResult.thinking?.length || 0,
        action: stepResult.action,
        finished: stepResult.finished,
        hasCallback: !!this.onStepResultCallback,
      })
    }

    // Call callback if provided
    this.onStepResultCallback?.(stepResult)

    return stepResult
  }

  /**
   * Get model response from Chatbox's model
   */
  private async getModelResponseFromChatbox(screenshot: { base64Data: string; width: number; height: number }): Promise<ModelResponse> {
    if (!this.agentConfig.chatboxModel) {
      throw new Error('Chatbox model not provided')
    }

    // Import required modules
    const { streamText } = await import('@/packages/model-calls')
    const { saveScreenshotToStorage } = await import('./bluestacksTaskHandler')

    // Save screenshot to storage
    const screenshotStorageKey = await saveScreenshotToStorage(screenshot.base64Data)

    // Build messages for Chatbox model
    const messages: Message[] = [...this.context]
    
    // Update the last user message to include screenshot
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'user' && lastMsg.contentParts) {
        // Add screenshot if not already present
        const hasImage = lastMsg.contentParts.some(p => p.type === 'image')
        if (!hasImage) {
          lastMsg.contentParts.push({
            type: 'image',
            storageKey: screenshotStorageKey,
          })
        }
      }
    }

    // Call Chatbox's streamText
    let thinking = ''
    let action = ''
    let completed = false
    let fullResponseText = ''
    let lastThinking = '' // Keep track of the last extracted thinking to avoid losing it

    // Store abort controller for stop functionality
    this.abortController = new AbortController()
    const controller = this.abortController

    let streamTextResult: any = null
    
    await new Promise<void>((resolve, reject) => {
      
      streamText(
        this.agentConfig.chatboxModel,
        {
          messages,
          providerOptions: {
            ...this.agentConfig.chatboxSettings?.providerOptions,
            stream: false, // Disable streaming for easier debugging
          },
          onResultChangeWithCancel: async (result) => {
            // Check if stopped during streaming
            if (this.isStopped) {
              controller.abort()
              return
            }
            
            // IMPORTANT: result.contentParts may have been processed by extractReasoningMiddleware
            // - type: "reasoning" contains the thinking content (from <think> tags)
            // - type: "text" contains the action (from <answer> tags)
            
            // Extract thinking from reasoning parts first (processed by extractReasoningMiddleware)
            const reasoningParts = result.contentParts?.filter(p => p.type === 'reasoning') || []
            if (reasoningParts.length > 0) {
              const reasoningText = reasoningParts.map(p => (p as any).text || '').join('').trim()
              if (reasoningText && reasoningText.length > 0) {
                thinking = reasoningText
                lastThinking = reasoningText
                if (this.agentConfig.verbose) {
                  console.log('[getModelResponseFromChatbox] Extracted thinking from reasoning part:', {
                    length: thinking.length,
                    preview: thinking.substring(0, 100),
                  })
                }
              }
            }
            
            // Extract text from the response
            const textParts = result.contentParts?.filter(p => p.type === 'text') || []
            const currentText = textParts.map(p => (p as any).text || '').join('')
            fullResponseText = currentText
            
            // Debug: Log the full response text for each update (only first few characters to avoid spam)
            if (this.agentConfig.verbose && fullResponseText.length > 0) {
              console.log(`[getModelResponseFromChatbox] Response text update (length: ${fullResponseText.length}):`, {
                preview: fullResponseText.substring(0, 200),
                hasRedactedReasoning: fullResponseText.includes('<think>'),
                hasAnswer: fullResponseText.includes('<answer>'),
                hasNestedThink: fullResponseText.includes('{think}'),
                hasReasoningPart: reasoningParts.length > 0,
              })
            }
            
            // Extract action from text content (remove <answer> tags)
            if (fullResponseText.includes('<answer>')) {
              const parts = fullResponseText.split('<answer>', 2)
              if (parts[1]) {
                action = parts[1].replace(/<\/answer>/g, '').trim()
              }
            } else if (fullResponseText.trim().length > 0) {
              // If no <answer> tag, treat entire response as action (like Python version)
              action = fullResponseText.trim()
            }
            
            // Fallback: If we still don't have thinking, try to extract from fullResponseText
            // This handles cases where the middleware hasn't processed it yet
            if (!thinking && fullResponseText.includes('<think>')) {
              const parts = fullResponseText.split('<answer>', 2)
              if (parts[0]) {
                let thinkingPart = parts[0].trim()
                // Remove <think> tags
                thinkingPart = thinkingPart.replace(/<think>/g, '').replace(/<\/redacted_reasoning>/g, '').trim()
                // Remove {think} prefix if present
                if (thinkingPart.startsWith('{think}')) {
                  thinkingPart = thinkingPart.substring(7).trim()
                }
                if (thinkingPart && thinkingPart.length > 0) {
                  thinking = thinkingPart
                  lastThinking = thinkingPart
                  if (this.agentConfig.verbose) {
                    console.log('[getModelResponseFromChatbox] Extracted thinking from text (fallback):', {
                      length: thinking.length,
                      preview: thinking.substring(0, 100),
                    })
                  }
                }
              }
            }
            
            // If we haven't extracted thinking yet but have lastThinking, use it
            if (!thinking && lastThinking) {
              thinking = lastThinking
            }
            
            // Debug logging - log every time we update during streaming
            if (this.agentConfig.verbose && fullResponseText.length > 0) {
              const hasRedactedReasoning = fullResponseText.includes('<think>')
              const hasThink = fullResponseText.includes('<think>')
              const hasReasoning = fullResponseText.includes('<reasoning>')
              const hasAnswer = fullResponseText.includes('<answer>')
              const hasNestedThink = fullResponseText.includes('{think}')
              
              console.log(`[getModelResponseFromChatbox] Streaming update (length: ${fullResponseText.length}):`, {
                thinkingExtracted: thinking ? `${thinking.substring(0, 50)}...` : '(empty)',
                lastThinking: lastThinking ? `${lastThinking.substring(0, 50)}...` : '(empty)',
                actionExtracted: action ? `${action.substring(0, 50)}...` : '(empty)',
                hasRedactedReasoning,
                hasThink,
                hasReasoning,
                hasAnswer,
                hasNestedThink,
                preview: fullResponseText.substring(0, 500),
              })
            }
          },
        },
        controller.signal
      )
        .then((streamResult) => {
          completed = true
          
          // Print full API response for debugging
          console.log('==================================================')
          console.log('[Qwen API Response] http://172.16.0.61:8234/v1/chat/completions')
          console.log('==================================================')
          console.log('Full streamResult:', JSON.stringify(streamResult, null, 2))
          console.log('==================================================')
          
          // In non-streaming mode, the final result might not be in onResultChangeWithCancel
          // So we need to extract from streamResult if available
          // IMPORTANT: streamResult.contentParts may have been processed by extractReasoningMiddleware
          // - type: "reasoning" contains the thinking content (from <think> tags)
          // - type: "text" contains the action (from <answer> tags)
          if (streamResult && streamResult.contentParts) {
            if (this.agentConfig.verbose) {
              console.log('[getModelResponseFromChatbox] streamResult received:', {
                contentPartsCount: streamResult.contentParts.length,
                contentPartsTypes: streamResult.contentParts.map((p: any) => p.type),
                currentFullResponseTextLength: fullResponseText.length,
              })
            }
            
            // Print all content parts
            console.log('[Qwen API Response] Content Parts:', streamResult.contentParts.map((p: any, idx: number) => ({
              index: idx,
              type: p.type,
              text: p.text ? p.text.substring(0, 500) : '(no text)',
              fullText: p.text,
            })))
            
            // Extract thinking from reasoning parts (processed by extractReasoningMiddleware)
            const reasoningParts = streamResult.contentParts.filter((p: any) => p.type === 'reasoning') || []
            if (reasoningParts.length > 0) {
              const reasoningText = reasoningParts.map((p: any) => p.text || '').join('').trim()
              if (reasoningText && reasoningText.length > 0) {
                thinking = reasoningText
                lastThinking = reasoningText
                console.log('[Qwen API Response] Extracted thinking from reasoning part:', {
                  length: thinking.length,
                  content: thinking,
                })
              }
            }
            
            // Extract action from text parts (which contain <answer>...</answer>)
            const textParts = streamResult.contentParts.filter((p: any) => p.type === 'text') || []
            const textContent = textParts.map((p: any) => p.text || '').join('')
            
            console.log('[Qwen API Response] Extracted text content:', {
              length: textContent.length,
              content: textContent,
              hasAnswer: textContent.includes('<answer>'),
            })
            
            // Extract action from text content (remove <answer> tags)
            if (textContent.includes('<answer>')) {
              const parts = textContent.split('<answer>', 2)
              if (parts[1]) {
                action = parts[1].replace(/<\/answer>/g, '').trim()
                console.log('[Qwen API Response] Extracted action from text part:', {
                  length: action.length,
                  content: action,
                })
              }
            } else if (textContent.trim().length > 0) {
              // If no <answer> tag, use the entire text content as action
              action = textContent.trim()
            }
            
            // Also build fullResponseText for backward compatibility
            const finalText = textContent
            if (finalText && finalText.length > 0) {
              fullResponseText = finalText
            }
            
            // If we still don't have thinking but have reasoning parts, try to extract from fullResponseText
            if (!thinking && fullResponseText.includes('<think>')) {
              const parts = fullResponseText.split('<answer>', 2)
              if (parts[0]) {
                let thinkingPart = parts[0].trim()
                thinkingPart = thinkingPart.replace(/<think>/g, '').replace(/<\/redacted_reasoning>/g, '').trim()
                if (thinkingPart && thinkingPart.length > 0) {
                  thinking = thinkingPart
                  lastThinking = thinkingPart
                }
              }
            }
          }
          
          resolve()
        })
        .catch((error) => {
          if (!completed) {
            reject(error)
          } else {
            resolve()
          }
        })
    })

    // If no action was extracted, use the full response
    if (!action && fullResponseText) {
      action = fullResponseText
    }

    // Final debug logging before returning
    if (this.agentConfig.verbose) {
      console.log('[getModelResponseFromChatbox] Final result:', {
        thinkingLength: thinking?.length || 0,
        thinkingPreview: thinking?.substring(0, 100) || '(empty)',
        actionLength: action?.length || 0,
        actionPreview: action?.substring(0, 100) || '(empty)',
        fullResponseTextLength: fullResponseText.length,
      })
    }

    // Final extraction attempt after streaming is complete (using Python-style simple parsing)
    // Re-extract from fullResponseText to ensure we get the complete thinking content
    // Support multiple formats:
    // 1. <think>{think}...content...`</think>`<answer>action</answer>
    // 2. {think}...content...\n\n<answer>action</answer>
    // 3. <think>...content...`</think>`<answer>action</answer>
    if (fullResponseText && fullResponseText.includes('<answer>')) {
      const parts = fullResponseText.split('<answer>', 2)
      
      // Extract thinking: remove tags and {think} prefix if present
      let thinkingPart = parts[0].trim()
      
      // Remove <think> tags (format 1)
      thinkingPart = thinkingPart.replace(/<think>/g, '').replace(/<\/think>/g, '').trim()
      
      // Remove <think> tags (format 3) - like Python version
      thinkingPart = thinkingPart.replace(/<think>/g, '').replace(/<\/redacted_reasoning>/g, '').trim()
      
      // Remove {think} prefix if present (both formats)
      if (thinkingPart.startsWith('{think}')) {
        thinkingPart = thinkingPart.substring(7).trim()
      }
      
      if (thinkingPart && thinkingPart.length > 0) {
        thinking = thinkingPart
        lastThinking = thinkingPart
        if (this.agentConfig.verbose) {
          console.log('[getModelResponseFromChatbox] Final extraction successful:', {
            thinkingLength: thinking.length,
            thinkingPreview: thinking.substring(0, 100),
            format: fullResponseText.includes('<think>') ? 'format1 (with tags)' : 'format2 (no tags)',
          })
        }
      }
      
      // Re-extract action if not already extracted
      if (parts[1] && !action) {
        action = parts[1].replace(/<\/answer>/g, '').trim()
      }
    } else if (this.agentConfig.verbose && !thinking) {
      console.log('[getModelResponseFromChatbox] Final extraction - no <answer> tag found', {
        fullResponseTextPreview: fullResponseText.substring(0, 500),
        hasRedactedReasoning: fullResponseText.includes('<think>'),
        hasAnswer: fullResponseText.includes('<answer>'),
        hasThinkPrefix: fullResponseText.includes('{think}'),
      })
    }
    
    // Only use default thinking if we truly have no thinking content
    // If thinking is empty but we have fullResponseText, try to extract it one more time
    if (!thinking && fullResponseText) {
      // First, try using lastThinking if we have it
      if (lastThinking && lastThinking.length > 0) {
        thinking = lastThinking
      } else {
        // Last attempt: check if there's any text before the first action-like pattern
        const actionPatterns = [
          /<answer>/,
          /do\s*\(/,
          /\{[\s\S]*"action"/,
        ]
        
        let earliestActionIndex = fullResponseText.length
        for (const pattern of actionPatterns) {
          const match = fullResponseText.match(pattern)
          if (match && match.index !== undefined && match.index < earliestActionIndex) {
            earliestActionIndex = match.index
          }
        }
        
        if (earliestActionIndex > 0 && earliestActionIndex < fullResponseText.length) {
          const potentialThinking = fullResponseText.substring(0, earliestActionIndex).trim()
          // Remove any XML-like tags that might be incomplete
          const cleaned = potentialThinking
            .replace(/^<[^>]*>/, '') // Remove opening tag at start
            .replace(/<\/[^>]*>$/, '') // Remove closing tag at end
            .trim()
          if (cleaned && cleaned.length > 10) {
            thinking = cleaned
            lastThinking = cleaned
          }
        }
      }
    }
    
    // Final check: if we still don't have thinking but have lastThinking, use it
    if (!thinking && lastThinking && lastThinking.length > 0) {
      thinking = lastThinking
    }
    
    // If still no thinking, provide a default thinking message
    // This ensures every step has some thinking content displayed
    if (!thinking || thinking.length === 0) {
      // Extract action type to provide context-aware default thinking
      let actionType = '执行操作'
      if (action) {
        if (action.includes('finish')) {
          actionType = '任务已完成'
        } else if (action.includes('Launch')) {
          actionType = '启动应用'
        } else if (action.includes('Tap')) {
          actionType = '点击屏幕元素'
        } else if (action.includes('Swipe')) {
          actionType = '滑动屏幕'
        } else if (action.includes('Type')) {
          actionType = '输入文本'
        } else if (action.includes('Back')) {
          actionType = '返回上一页'
        }
      }
      thinking = `正在分析屏幕状态并${actionType}...`
      
      if (this.agentConfig.verbose) {
        console.log('[getModelResponseFromChatbox] Using default thinking:', thinking)
      }
    }
    
    // Log final extraction result
    if (this.agentConfig.verbose) {
      console.log('[getModelResponseFromChatbox] Final extraction:', {
        thinkingFinal: thinking ? `${thinking.substring(0, 100)}...` : '(empty)',
        lastThinkingFinal: lastThinking ? `${lastThinking.substring(0, 100)}...` : '(empty)',
        fullResponseTextPreview: fullResponseText.substring(0, 500),
        isDefaultThinking: !lastThinking && thinking.includes('正在分析'),
      })
    }

    return {
      thinking: thinking, // Always return thinking, even if it's a default message
      action: action || 'No action specified',
      rawContent: JSON.stringify({ thinking, action, fullResponseText }, null, 2),
    }
  }

  /**
   * Get model response from BlueStacks task stream
   */
  private async getModelResponseFromTask(): Promise<ModelResponse> {
    if (!this.taskId) {
      throw new Error('No task ID available')
    }

    return new Promise((resolve, reject) => {
      let thinking = ''
      let action = ''
      let completed = false

      const closeStream = bsClient.streamTask(
        this.cfg,
        this.sessionId!,
        this.taskId!,
        {
          onProgress: (data: any) => {
            // Accumulate thinking/action from progress updates
            if (data.thinking) {
              thinking += data.thinking + '\n'
            }
            if (data.action) {
              action = data.action
            }
          },
          onAwaitInput: (data: any) => {
            // Handle input requests
            console.log('Awaiting input:', data)
          },
          onCompleted: (data: any) => {
            completed = true
            if (data.thinking) {
              thinking = data.thinking
            }
            if (data.action) {
              action = data.action
            }
            resolve({
              thinking: thinking.trim(),
              action: action.trim(),
              rawContent: JSON.stringify(data),
            })
          },
          onError: (err: any) => {
            if (!completed) {
              reject(new Error(`Stream error: ${JSON.stringify(err)}`))
            }
          },
          onClose: () => {
            if (!completed) {
              reject(new Error('Stream closed before completion'))
            }
          },
        }
      )

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!completed) {
          closeStream()
          reject(new Error('Task timeout'))
        }
      }, 60000)
    })
  }

  /**
   * Build screen info string
   */
  private buildScreenInfo(currentApp: string, extraInfo?: Record<string, any>): string {
    const info = {
      current_app: currentApp,
      ...extraInfo,
    }
    return JSON.stringify(info, null, 2)
  }

  /**
   * Get default system prompt
   */
  private getDefaultSystemPrompt(lang: 'cn' | 'en'): string {
    if (lang === 'en') {
      return `You are an intelligent agent analysis expert who can execute a series of operations based on operation history and current state screenshots to complete tasks.

You must strictly follow the required output format:

<think>{think}</think>

<answer>{action}</answer>

Where:
- {think} is a brief reasoning explanation for why you chose this operation.
- {action} is the specific operation instruction for this execution, which must strictly follow the instruction format defined below.

Operation instructions and their functions:

- do(action="Launch", app="xxx")
  Launch is the operation to start the target app, which is faster than navigating through the home screen. After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Tap", element=[x,y])
  Tap is a click operation that clicks a specific point on the screen. Use this operation to click buttons, select items, open applications from the home screen, or interact with any clickable UI elements. The coordinate system starts from the top-left corner (0,0) to the bottom-right corner (999,999). After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Tap", element=[x,y], message="Important operation")
  Same basic function as Tap, but triggers when clicking sensitive buttons involving property, payment, privacy, etc.

- do(action="Type", text="xxx")
  Type is an input operation that inputs text into the currently focused input box. Before using this operation, ensure the input box is focused (click it first). The input text will be entered as if using a keyboard. Important: The phone may be using an ADB keyboard that doesn't take up screen space like a normal keyboard. To confirm the keyboard is activated, check if the bottom of the screen shows text like 'ADB Keyboard {ON}', or check if the input box is active/highlighted. Don't rely solely on visual keyboard display. Auto-clear text: When you use the input operation, any existing text in the input box (including placeholder text and actual input) will be automatically cleared before entering new text. You don't need to manually clear text before inputting—directly use the input operation to enter the required text. After the operation completes, you will automatically receive a screenshot of the result state.

- do(action="Type_Name", text="xxx")
  Type_Name is an operation to input a person's name, with the same basic function as Type.

- do(action="Interact")
  Interact is an interactive operation triggered when there are multiple options that meet the conditions, asking the user how to choose.

- do(action="Swipe", start=[x1,y1], end=[x2,y2])
  Swipe is a swipe operation that performs a swipe gesture by dragging from the start coordinates to the end coordinates. Can be used to scroll content, navigate between screens, pull down the notification bar, item bars, or perform gesture-based navigation. The coordinate system starts from the top-left corner (0,0) to the bottom-right corner (999,999). Swipe duration is automatically adjusted for natural movement. After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Note", message="True")
  Record the current page content for subsequent summarization.

- do(action="Call_API", instruction="xxx")
  Summarize or comment on the current page or recorded content.

- do(action="Long Press", element=[x,y])
  Long Press is a long-press operation that long-presses a specific point on the screen for a specified time. Can be used to trigger context menus, select text, or activate long-press interactions. The coordinate system starts from the top-left corner (0,0) to the bottom-right corner (999,999). After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Double Tap", element=[x,y])
  Double Tap quickly taps twice in succession at a specific point on the screen. Use this operation to activate double-tap interactions such as zooming, selecting text, or opening items. The coordinate system starts from the top-left corner (0,0) to the bottom-right corner (999,999). After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Take_over", message="xxx")
  Take_over is a takeover operation, indicating that user assistance is needed during login and verification phases.

- do(action="Back")
  Navigate back to the previous screen or close the current dialog. Equivalent to pressing Android's back button. Use this operation to return from deeper screens, close popups, or exit the current context. After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Home")
  Home is the operation to return to the system desktop, equivalent to pressing Android's home screen button. Use this operation to exit the current app and return to the launcher, or start a new task from a known state. After this operation completes, you will automatically receive a screenshot of the result state.

- do(action="Wait", duration="x seconds")
  Wait for the page to load, where x is the number of seconds to wait.

- finish(message="xxx")
  finish is the operation to end the task, indicating that the task has been accurately and completely completed. message is the termination information.

Rules that must be followed:

1. Before executing any operation, first check if the current app is the target app. If not, execute Launch first.

2. If you enter an irrelevant page, execute Back first. If the page doesn't change after executing Back, click the back button in the top-left corner of the page, or the X button in the top-right corner to close.

3. If the page content hasn't loaded, Wait at most three times consecutively, otherwise execute Back to re-enter.

4. If the page shows a network problem and needs to reload, click reload.

5. If the current page cannot find target contacts, products, stores, etc., you can try Swipe to search.

6. When encountering filter conditions like price ranges, time ranges, etc., if there are no completely matching ones, you can relax the requirements.

7. When doing Xiaohongshu summary tasks, you must filter graphic notes.

8. After selecting all in the shopping cart, clicking select all again can set the state to unselect all. When doing shopping cart tasks, if items in the cart are already selected, you need to click select all and then click deselect all, then find the items that need to be purchased or deleted.

9. When doing takeout tasks, if the corresponding store's cart already has other items, you need to clear the cart first before purchasing the user-specified takeout.

10. When doing takeout tasks, if the user needs to order multiple takeouts, please try to purchase from the same store. If it cannot be found, you can place an order and explain that a certain item was not found.

11. Please strictly follow the user's intent to execute tasks. Users' special requirements can execute multiple searches and swipe searches. For example: (i) User requests a cup of coffee, wants it salty, you can directly search for salty coffee, or search for coffee and swipe to find salty coffee, such as sea salt coffee. (ii) User wants to find XX group and send a message, you can first search for XX group, if no results are found, remove the word "group" and search for XX again. (iii) User wants to find a pet-friendly restaurant, you can search for restaurant, find filters, find facilities, select pet-friendly, or directly search for pet-friendly, and use AI search when necessary.

12. When selecting dates, if the original swipe direction moves further away from the expected date, swipe in the opposite direction to search.

13. During task execution, if there are multiple selectable item bars, search each item bar one by one until the task is completed. Do not search the same item bar multiple times, causing an infinite loop.

14. Before executing the next operation, always check if the previous operation took effect. If the click didn't work, it may be because the app reacted slowly. Please wait a bit first. If it still doesn't work, adjust the click position and retry. If it still doesn't work, skip this step and continue the task, and explain in the finish message that the click didn't work.

15. During task execution, if swiping doesn't work, adjust the starting point position and increase the swipe distance to retry. If it still doesn't work, it might be because you've already swiped to the bottom. Please continue swiping in the opposite direction until the top or bottom. If there are still no results that meet the requirements, skip this step and continue the task, and explain in the finish message that the required item was not found.

16. When doing game tasks, if there is auto-battle in the battle page, you must enable auto-battle. If multiple rounds of historical states are similar, check if auto-battle is enabled.

17. If there are no suitable search results, it may be because the search page is incorrect. Please return to the previous level of the search page and try searching again. If you still don't find results that meet the requirements after trying to return to the previous level three times, execute finish(message="reason").

18. Before ending the task, always carefully check if the task has been completely and accurately completed. If there are cases of wrong selection, missed selection, or multiple selections, please return to previous steps to correct them.`
    }
    return `你是一个智能体分析专家，可以根据操作历史和当前状态图执行一系列操作来完成任务。

你必须严格按照要求输出以下格式：

<think>{think}</think>

<answer>{action}</answer>

其中：

- {think} 是对你为什么选择这个操作的简短推理说明。

- {action} 是本次执行的具体操作指令，必须严格遵循下方定义的指令格式。

操作指令及其作用如下：

- do(action="Launch", app="xxx")  

    Launch是启动目标app的操作，这比通过主屏幕导航更快。此操作完成后，您将自动收到结果状态的截图。

- do(action="Tap", element=[x,y])  

    Tap是点击操作，点击屏幕上的特定点。可用此操作点击按钮、选择项目、从主屏幕打开应用程序，或与任何可点击的用户界面元素进行交互。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。

- do(action="Tap", element=[x,y], message="重要操作")  

    基本功能同Tap，点击涉及财产、支付、隐私等敏感按钮时触发。

- do(action="Type", text="xxx")  

    Type是输入操作，在当前聚焦的输入框中输入文本。使用此操作前，请确保输入框已被聚焦（先点击它）。输入的文本将像使用键盘输入一样输入。重要提示：手机可能正在使用 ADB 键盘，该键盘不会像普通键盘那样占用屏幕空间。要确认键盘已激活，请查看屏幕底部是否显示 'ADB Keyboard {ON}' 类似的文本，或者检查输入框是否处于激活/高亮状态。不要仅仅依赖视觉上的键盘显示。自动清除文本：当你使用输入操作时，输入框中现有的任何文本（包括占位符文本和实际输入）都会在输入新文本前自动清除。你无需在输入前手动清除文本——直接使用输入操作输入所需文本即可。操作完成后，你将自动收到结果状态的截图。

- do(action="Type_Name", text="xxx")  

    Type_Name是输入人名的操作，基本功能同Type。

- do(action="Interact")  

    Interact是当有多个满足条件的选项时而触发的交互操作，询问用户如何选择。

- do(action="Swipe", start=[x1,y1], end=[x2,y2])  

    Swipe是滑动操作，通过从起始坐标拖动到结束坐标来执行滑动手势。可用于滚动内容、在屏幕之间导航、下拉通知栏以及项目栏或进行基于手势的导航。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。滑动持续时间会自动调整以实现自然的移动。此操作完成后，您将自动收到结果状态的截图。

- do(action="Note", message="True")  

    记录当前页面内容以便后续总结。

- do(action="Call_API", instruction="xxx")  

    总结或评论当前页面或已记录的内容。

- do(action="Long Press", element=[x,y])  

    Long Pres是长按操作，在屏幕上的特定点长按指定时间。可用于触发上下文菜单、选择文本或激活长按交互。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的屏幕截图。

- do(action="Double Tap", element=[x,y])  

    Double Tap在屏幕上的特定点快速连续点按两次。使用此操作可以激活双击交互，如缩放、选择文本或打开项目。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。

- do(action="Take_over", message="xxx")  

    Take_over是接管操作，表示在登录和验证阶段需要用户协助。

- do(action="Back")  

    导航返回到上一个屏幕或关闭当前对话框。相当于按下 Android 的返回按钮。使用此操作可以从更深的屏幕返回、关闭弹出窗口或退出当前上下文。此操作完成后，您将自动收到结果状态的截图。

- do(action="Home") 

    Home是回到系统桌面的操作，相当于按下 Android 主屏幕按钮。使用此操作可退出当前应用并返回启动器，或从已知状态启动新任务。此操作完成后，您将自动收到结果状态的截图。

- do(action="Wait", duration="x seconds")  

    等待页面加载，x为需要等待多少秒。

- finish(message="xxx")  

    finish是结束任务的操作，表示准确完整完成任务，message是终止信息。 

必须遵循的规则：

1. 在执行任何操作前，先检查当前app是否是目标app，如果不是，先执行 Launch。

2. 如果进入到了无关页面，先执行 Back。如果执行Back后页面没有变化，请点击页面左上角的返回键进行返回，或者右上角的X号关闭。

3. 如果页面未加载出内容，最多连续 Wait 三次，否则执行 Back重新进入。

4. 如果页面显示网络问题，需要重新加载，请点击重新加载。

5. 如果当前页面找不到目标联系人、商品、店铺等信息，可以尝试 Swipe 滑动查找。

6. 遇到价格区间、时间区间等筛选条件，如果没有完全符合的，可以放宽要求。

7. 在做小红书总结类任务时一定要筛选图文笔记。

8. 购物车全选后再点击全选可以把状态设为全不选，在做购物车任务时，如果购物车里已经有商品被选中时，你需要点击全选后再点击取消全选，再去找需要购买或者删除的商品。

9. 在做外卖任务时，如果相应店铺购物车里已经有其他商品你需要先把购物车清空再去购买用户指定的外卖。

10. 在做点外卖任务时，如果用户需要点多个外卖，请尽量在同一店铺进行购买，如果无法找到可以下单，并说明某个商品未找到。

11. 请严格遵循用户意图执行任务，用户的特殊要求可以执行多次搜索，滑动查找。比如（i）用户要求点一杯咖啡，要咸的，你可以直接搜索咸咖啡，或者搜索咖啡后滑动查找咸的咖啡，比如海盐咖啡。（ii）用户要找到XX群，发一条消息，你可以先搜索XX群，找不到结果后，将"群"字去掉，搜索XX重试。（iii）用户要找到宠物友好的餐厅，你可以搜索餐厅，找到筛选，找到设施，选择可带宠物，或者直接搜索可带宠物，必要时可以使用AI搜索。

12. 在选择日期时，如果原滑动方向与预期日期越来越远，请向反方向滑动查找。

13. 执行任务过程中如果有多个可选择的项目栏，请逐个查找每个项目栏，直到完成任务，一定不要在同一项目栏多次查找，从而陷入死循环。

14. 在执行下一步操作前请一定要检查上一步的操作是否生效，如果点击没生效，可能因为app反应较慢，请先稍微等待一下，如果还是不生效请调整一下点击位置重试，如果仍然不生效请跳过这一步继续任务，并在finish message说明点击不生效。

15. 在执行任务中如果遇到滑动不生效的情况，请调整一下起始点位置，增大滑动距离重试，如果还是不生效，有可能是已经滑到底了，请继续向反方向滑动，直到顶部或底部，如果仍然没有符合要求的结果，请跳过这一步继续任务，并在finish message说明但没找到要求的项目。

16. 在做游戏任务时如果在战斗页面如果有自动战斗一定要开启自动战斗，如果多轮历史状态相似要检查自动战斗是否开启。

17. 如果没有合适的搜索结果，可能是因为搜索页面不对，请返回到搜索页面的上一级尝试重新搜索，如果尝试三次返回上一级搜索后仍然没有符合要求的结果，执行 finish(message="原因")。

18. 在结束任务前请一定要仔细检查任务是否完整准确的完成，如果出现错选、漏选、多选的情况，请返回之前的步骤进行纠正。`
  }
}

