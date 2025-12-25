/**
 * BlueStacks Task Handler - Integrates PhoneAgent with Chatbox message system
 */

import type { BluestacksConfig } from '../bluestacksClient'
import { PhoneAgent, type AgentConfig, type StepResult } from './agent'
import type { Message } from 'src/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { createModelDependencies } from '@/adapters'

export interface BluestacksTaskOptions {
  sessionId: string
  userMessage: Message
  assistantMessage: Message
  onStepUpdate: (stepResult: StepResult, screenshot?: string) => Promise<void>
  onComplete: (finalMessage: string) => Promise<void>
  onError: (error: Error) => Promise<void>
  onCancelReady?: (cancelFn: () => void) => void
}

/**
 * Check if a message contains BlueStacks automation task
 */
export function isBluestacksTask(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const taskKeywords = [
    '打开',
    'open',
    '启动',
    'launch',
    '点击',
    'tap',
    '滑动',
    'swipe',
    '输入',
    'type',
    '设置',
    'settings',
    '应用',
    'app',
  ]

  // Check if message contains task keywords
  return taskKeywords.some((keyword) => lowerMessage.includes(keyword))
}

/**
 * Get BlueStacks configuration from settings
 * TODO: This should read from actual settings store
 */
export function getBluestacksConfig(): BluestacksConfig {
  // For now, use default localhost
  // In production, read from settings store
  return {
    baseUrl: 'http://localhost:8080',
  }
}

/**
 * Get LLM configuration for BlueStacks agent server
 * Reads from Chatbox settings if available
 */
export async function getLLMConfig(): Promise<any> {
  try {
    // Try to read from Chatbox settings
    const { settingsStore } = await import('@/stores/settingsStore')
    const { ModelProviderEnum } = await import('src/shared/types')
    const settings = settingsStore.getState()
    
    // Try to get GoogleGenAI/Gemini API key from settings
    const geminiSettings = settings.providers?.[ModelProviderEnum.Gemini]
    const googleGenAISettings = settings.providers?.['GoogleGenAI' as any] // Some providers might use this name
    
    // Use provider from settings if available, otherwise default
    const provider = geminiSettings ? 'GoogleGenAI' : 'GoogleGenAI'
    const model = geminiSettings?.models?.[0]?.modelId || 'gemini-2.5-pro'
    
    return {
      provider,
      model,
      temperature: 0.2,
      max_tokens: 4096,
      max_steps: 25,
      timeout: 1200,
      vision: true,
      accessibility: true,
    }
  } catch (error) {
    // Fallback to default config
    console.warn('Failed to read LLM config from settings, using defaults:', error)
    return {
      provider: 'GoogleGenAI',
      model: 'gemini-2.5-pro',
      temperature: 0.2,
      max_tokens: 4096,
      max_steps: 25,
      timeout: 1200,
      vision: true,
      accessibility: true,
    }
  }
}

/**
 * Handle BlueStacks automation task
 */
export async function handleBluestacksTask(options: BluestacksTaskOptions): Promise<void> {
  const { sessionId, userMessage, assistantMessage, onStepUpdate, onComplete, onError, onCancelReady } = options

  const userText = userMessage.contentParts?.find((p) => p.type === 'text')?.text || ''
  if (!userText) {
    await onError(new Error('No task description provided'))
    return
  }

  const bsConfig = getBluestacksConfig()
  
  // Get Chatbox model settings from the session BEFORE creating agent
  const { getSession } = await import('@/stores/chatStore')
  const { settingsStore } = await import('@/stores/settingsStore')
  const { getModel } = await import('src/shared/models')
  const { createModelDependencies } = await import('@/adapters')
  
  const session = await getSession(sessionId)
  const globalSettings = settingsStore.getState().getSettings()
  // const sessionSettings = session?.settings || {}
  const sessionSettings = { ...(session?.settings || {}) }

// Disable streaming for easier debugging
  sessionSettings.stream = false
  // Try to use Chatbox's model instead of Agent Server's LLM
  let chatboxModel: any = null
  let useChatboxModel = false
  let llmConfig: any = null
  
  try {
    const dependencies = await createModelDependencies()
    chatboxModel = getModel(sessionSettings, globalSettings, { uuid: sessionId || '' }, dependencies)
    useChatboxModel = true
    console.log(`[PhoneAgent] Using Chatbox model: ${sessionSettings.provider}/${sessionSettings.modelId}`)
  } catch (error) {
    console.warn('[PhoneAgent] Failed to get Chatbox model, falling back to Agent Server LLM:', error)
    // Fallback to Agent Server LLM
    llmConfig = await getLLMConfig()
  }

  const agentConfig: AgentConfig = {
    maxSteps: 50,
    lang: 'cn',
    verbose: true,
    useChatboxModel,
    chatboxModel,
    chatboxSettings: sessionSettings,
    chatboxGlobalSettings: globalSettings,
  }

  let agentSessionId: string | undefined
  let agentInstance: PhoneAgent | null = null
  let cancelFunction: (() => void) | null = null

  const agent = new PhoneAgent(bsConfig, agentConfig, {
    onStepResult: async (stepResult: StepResult) => {
      try {
        // Debug logging
        console.log('[bluestacksTaskHandler] onStepResult called:', {
          stepCount: stepResult.action?._metadata === 'do' ? 'step' : 'unknown',
          thinking: stepResult.thinking ? `${stepResult.thinking.substring(0, 100)}...` : '(empty)',
          thinkingLength: stepResult.thinking?.length || 0,
          action: stepResult.action,
          hasScreenshot: !!stepResult.screenshot,
        })

        // Use screenshot from stepResult to avoid duplicate calls
        // Screenshot is already captured in executeStep
        const screenshot: string | undefined = stepResult.screenshot?.base64Data

        await onStepUpdate(stepResult, screenshot)
      } catch (error) {
        console.error('Error updating step:', error)
      }
    },
  })

  try {
    // Store agent instance for cancellation
    agentInstance = agent

    // Create cancel function
    cancelFunction = () => {
      if (agentInstance) {
        agentInstance.stop()
      }
    }

    // Notify that cancel function is ready (before initialization so UI can set it up)
    if (onCancelReady) {
      onCancelReady(cancelFunction)
    }

    // Initialize agent
    await agent.initialize()
    agentSessionId = agent.getSessionId()

    // Run the task
    const result = await agent.run(userText, llmConfig)

    await onComplete(result)
  } catch (error) {
    // Provide user-friendly error messages for common errors
    let errorMessage = error instanceof Error ? error.message : String(error)
    
    // Handle LLM API Key error
    if (errorMessage.includes('llm_api_key_not_found') || errorMessage.includes('401') || 
        (typeof error === 'object' && error !== null && 'error' in error && error.error === 'llm_api_key_not_found')) {
      const modelInfo = llmConfig 
        ? `${llmConfig.provider} / ${llmConfig.model}`
        : 'GoogleGenAI / gemini-2.5-pro'
      
      errorMessage = 
        `LLM API Key not found\n\n` +
        `BlueStacks AI Agent Server requires an LLM API Key to execute tasks.\n\n` +
        `Current model: ${modelInfo}\n\n` +
        `Solution:\n` +
        `1. Configure API Key in BlueStacks AppPlayer\n` +
        `   - Open BlueStacks AppPlayer\n` +
        `   - Go to Settings → AI Agent Settings\n` +
        `   - Configure ${llmConfig?.provider || 'GoogleGenAI'} API Key\n\n` +
        `2. Ensure API Key is correctly configured in BlueStacks AppPlayer\n` +
        `   (Agent Server will retrieve API Key from AppPlayer)\n\n` +
        `Original error: ${errorMessage}`
    }
    
    await onError(new Error(errorMessage))
  } finally {
    agentInstance = null
    cancelFunction = null
    await agent.close()
  }
}

/**
 * Save screenshot base64 to storage and return storageKey
 */
export async function saveScreenshotToStorage(base64Data: string): Promise<string> {
  const dependencies = await createModelDependencies()
  const dataUrl = `data:image/png;base64,${base64Data}`
  return dependencies.storage.saveImage('bluestacks', dataUrl)
}

/**
 * Get session ID from PhoneAgent (helper method)
 */
export function getAgentSessionId(agent: PhoneAgent): string | undefined {
  // @ts-ignore - accessing private property for helper
  return agent.sessionId
}

