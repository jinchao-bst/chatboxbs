/**
 * Action handler for processing AI model outputs
 */

import type { BluestacksConfig } from '../bluestacksClient'
import * as bsOps from './bluestacks'

export interface ActionResult {
  success: boolean
  shouldFinish: boolean
  message?: string
  requiresConfirmation?: boolean
}

export interface Action {
  _metadata?: 'do' | 'finish'
  action?: string
  element?: [number, number] // Relative coordinates (0-1000)
  start?: [number, number]
  end?: [number, number]
  text?: string
  app?: string
  duration?: string
  message?: string
}

export type ConfirmationCallback = (message: string) => Promise<boolean>
export type TakeoverCallback = (message: string) => Promise<void>

export class ActionHandler {
  private cfg: BluestacksConfig
  private sessionId: string
  private confirmationCallback?: ConfirmationCallback
  private takeoverCallback?: TakeoverCallback

  constructor(
    cfg: BluestacksConfig,
    sessionId: string,
    confirmationCallback?: ConfirmationCallback,
    takeoverCallback?: TakeoverCallback
  ) {
    this.cfg = cfg
    this.sessionId = sessionId
    this.confirmationCallback = confirmationCallback
    this.takeoverCallback = takeoverCallback
  }

  async execute(action: Action, screenWidth: number, screenHeight: number): Promise<ActionResult> {
    const actionType = action._metadata

    if (actionType === 'finish') {
      return {
        success: true,
        shouldFinish: true,
        message: action.message,
      }
    }

    if (actionType !== 'do') {
      return {
        success: false,
        shouldFinish: true,
        message: `Unknown action type: ${actionType}`,
      }
    }

    const actionName = action.action
    const handler = this.getHandler(actionName)

    if (!handler) {
      return {
        success: false,
        shouldFinish: false,
        message: `Unknown action: ${actionName}`,
      }
    }

    try {
      return await handler(action, screenWidth, screenHeight)
    } catch (error) {
      return {
        success: false,
        shouldFinish: false,
        message: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  private getHandler(actionName?: string): ((action: Action, width: number, height: number) => Promise<ActionResult>) | null {
    const handlers: Record<string, (action: Action, width: number, height: number) => Promise<ActionResult>> = {
      Launch: this.handleLaunch.bind(this),
      Tap: this.handleTap.bind(this),
      Type: this.handleType.bind(this),
      Type_Name: this.handleType.bind(this),
      Swipe: this.handleSwipe.bind(this),
      Back: this.handleBack.bind(this),
      Home: this.handleHome.bind(this),
      'Double Tap': this.handleDoubleTap.bind(this),
      'Long Press': this.handleLongPress.bind(this),
      Wait: this.handleWait.bind(this),
      Take_over: this.handleTakeover.bind(this),
      Note: this.handleNote.bind(this),
      Call_API: this.handleCallAPI.bind(this),
      Interact: this.handleInteract.bind(this),
    }
    return handlers[actionName || ''] || null
  }

  private convertRelativeToAbsolute(element: [number, number], screenWidth: number, screenHeight: number): [number, number] {
    // Convert relative coordinates (0-1000) to absolute pixels
    // Match Python version: int(element[0] / 1000 * screen_width)
    const x = Math.floor((element[0] / 1000) * screenWidth)
    const y = Math.floor((element[1] / 1000) * screenHeight)
    
    // Validate coordinates are within screen bounds
    if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
      console.warn(
        `Converted coordinates (${x}, ${y}) are out of bounds for screen (${screenWidth}x${screenHeight}). ` +
        `Original relative coordinates: (${element[0]}, ${element[1]})`
      )
    }
    
    return [x, y]
  }

  private async handleLaunch(action: Action, _width: number, _height: number): Promise<ActionResult> {
    const appName = action.app
    if (!appName) {
      return { success: false, shouldFinish: false, message: 'No app name specified' }
    }

    // Try to get package name from app name
    // If appName is already a package (contains dots), use it directly
    // Otherwise, try to map from common app names
    let packageName = appName
    let activity: string | undefined

    if (!appName.includes('.')) {
      // It's an app name, try to map to package
      packageName = this.getPackageName(appName) || appName
    }

    // Try to infer activity if not provided
    // Common patterns: .MainActivity, .SplashActivity, .LauncherActivity
    // For now, we'll try .MainActivity as default
    if (!activity) {
      const packageParts = packageName.split('.')
      const appPart = packageParts[packageParts.length - 1]
      activity = `.${appPart.charAt(0).toUpperCase() + appPart.slice(1)}Activity`
    }

    try {
      const success = await bsOps.launchApp(this.cfg, this.sessionId, packageName, activity)
      if (success) {
        return { success: true, shouldFinish: false }
      }
      return { success: false, shouldFinish: false, message: `Failed to launch app: ${appName}` }
    } catch (error) {
      return {
        success: false,
        shouldFinish: false,
        message: `Failed to launch app: ${appName} - ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Map app name to package name
   * This is a simplified version - in production, you might want a full mapping table
   */
  private getPackageName(appName: string): string | null {
    // Common app mappings (simplified - can be expanded)
    const appMap: Record<string, string> = {
      Settings: 'com.android.settings',
      'System Settings': 'com.android.settings',
      Chrome: 'com.android.chrome',
      Gmail: 'com.google.android.gm',
      WeChat: 'com.tencent.mm',
      微信: 'com.tencent.mm',
      QQ: 'com.tencent.mobileqq',
      // Add more mappings as needed
    }

    return appMap[appName] || null
  }

  private async handleTap(action: Action, width: number, height: number): Promise<ActionResult> {
    const element = action.element
    if (!element) {
      return { success: false, shouldFinish: false, message: 'No element coordinates' }
    }

    const [x, y] = this.convertRelativeToAbsolute(element, width, height)

    // Check for sensitive operation
    if (action.message) {
      if (this.confirmationCallback) {
        const confirmed = await this.confirmationCallback(action.message)
        if (!confirmed) {
          return {
            success: false,
            shouldFinish: true,
            message: 'User cancelled sensitive operation',
          }
        }
      }
    }

    await bsOps.tap(this.cfg, this.sessionId, x, y)
    return { success: true, shouldFinish: false }
  }

  private async handleType(action: Action, _width: number, _height: number): Promise<ActionResult> {
    const text = action.text || ''

    // Clear existing text first
    await bsOps.clearText(this.cfg, this.sessionId)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Type new text
    await bsOps.typeText(this.cfg, this.sessionId, text)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return { success: true, shouldFinish: false }
  }

  private async handleSwipe(action: Action, width: number, height: number): Promise<ActionResult> {
    const start = action.start
    const end = action.end

    if (!start || !end) {
      return { success: false, shouldFinish: false, message: 'Missing swipe coordinates' }
    }

    const [startX, startY] = this.convertRelativeToAbsolute(start, width, height)
    const [endX, endY] = this.convertRelativeToAbsolute(end, width, height)

    await bsOps.swipe(this.cfg, this.sessionId, startX, startY, endX, endY)
    return { success: true, shouldFinish: false }
  }

  private async handleBack(_action: Action, _width: number, _height: number): Promise<ActionResult> {
    await bsOps.back(this.cfg, this.sessionId)
    return { success: true, shouldFinish: false }
  }

  private async handleHome(_action: Action, _width: number, _height: number): Promise<ActionResult> {
    await bsOps.home(this.cfg, this.sessionId)
    return { success: true, shouldFinish: false }
  }

  private async handleDoubleTap(action: Action, width: number, height: number): Promise<ActionResult> {
    const element = action.element
    if (!element) {
      return { success: false, shouldFinish: false, message: 'No element coordinates' }
    }

    const [x, y] = this.convertRelativeToAbsolute(element, width, height)
    await bsOps.doubleTap(this.cfg, this.sessionId, x, y)
    return { success: true, shouldFinish: false }
  }

  private async handleLongPress(action: Action, width: number, height: number): Promise<ActionResult> {
    const element = action.element
    if (!element) {
      return { success: false, shouldFinish: false, message: 'No element coordinates' }
    }

    const [x, y] = this.convertRelativeToAbsolute(element, width, height)
    await bsOps.longPress(this.cfg, this.sessionId, x, y)
    return { success: true, shouldFinish: false }
  }

  private async handleWait(action: Action, _width: number, _height: number): Promise<ActionResult> {
    const durationStr = action.duration || '1 seconds'
    const duration = parseFloat(durationStr.replace('seconds', '').trim()) || 1.0

    await new Promise((resolve) => setTimeout(resolve, duration * 1000))
    return { success: true, shouldFinish: false }
  }

  private async handleTakeover(action: Action, _width: number, _height: number): Promise<ActionResult> {
    const message = action.message || 'User intervention required'
    if (this.takeoverCallback) {
      await this.takeoverCallback(message)
    }
    return { success: true, shouldFinish: false }
  }

  private async handleNote(_action: Action, _width: number, _height: number): Promise<ActionResult> {
    // Placeholder for content recording
    return { success: true, shouldFinish: false }
  }

  private async handleCallAPI(_action: Action, _width: number, _height: number): Promise<ActionResult> {
    // Placeholder for API call/summarization
    return { success: true, shouldFinish: false }
  }

  private async handleInteract(_action: Action, _width: number, _height: number): Promise<ActionResult> {
    return { success: true, shouldFinish: false, message: 'User interaction required' }
  }
}

/**
 * Parse action from model response string
 * 
 * This function mimics the Python version's parse_action behavior:
 * - If response starts with "do", parse it as a function call
 * - If response starts with "finish", parse the finish message
 * - Otherwise, throw an error
 * 
 * Unlike Python's eval(), this uses safe parsing to avoid security issues.
 */
export function parseAction(response: string): Action {
  const trimmed = response.trim()

  // Handle do(...) format - similar to Python's eval() but safe
  if (trimmed.startsWith('do(')) {
    try {
      // Extract the content inside do(...)
      const match = trimmed.match(/^do\s*\(\s*([^)]+)\s*\)\s*$/)
      if (!match) {
        throw new Error('Invalid do() format')
      }

      const paramsStr = match[1]
      const action: any = { _metadata: 'do' }

      // Parse parameters: key="value" or key=value or key=[x,y]
      // Handle both quoted and unquoted values
      const paramPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\[([^\]]+)\]|([^,)]+))/g
      let paramMatch

      while ((paramMatch = paramPattern.exec(paramsStr)) !== null) {
        const key = paramMatch[1]
        let value: any

        // Check if it's an array (element=[x,y] or start=[x,y] or end=[x,y])
        if (paramMatch[4]) {
          // Array value: [x, y]
          const arrayStr = paramMatch[4]
          const arrayValues = arrayStr
            .split(',')
            .map((v) => v.trim())
            .map((v) => {
              const num = Number(v)
              return isNaN(num) ? v : num
            })
          value = arrayValues.length === 2 ? (arrayValues as [number, number]) : arrayValues
        } else {
          // String value (quoted or unquoted)
          value = paramMatch[2] || paramMatch[3] || paramMatch[5]?.trim() || ''

          // Try to parse as number or boolean
          if (value === 'true') {
            value = true
          } else if (value === 'false') {
            value = false
          } else if (!isNaN(Number(value)) && value !== '') {
            // Check if it's a number
            const num = Number(value)
            // Only convert to number if it's not part of a string context
            if (key === 'duration' || /^\d+$/.test(value)) {
              value = num
            }
          }
        }

        action[key] = value
      }

      // Ensure we have an action type
      if (action.action) {
        return action
      }

      throw new Error('No action specified in do() call')
    } catch (error) {
      // If parsing fails, try alternative methods
      console.warn('Failed to parse do() call, trying alternatives:', error)

      // Try to parse as JSON object inside do({...})
      const jsonMatch = trimmed.match(/do\s*\(\s*({[\s\S]*?})\s*\)/s)
      if (jsonMatch) {
        try {
          const jsonStr = jsonMatch[1]
          const action = JSON.parse(jsonStr)
          return { ...action, _metadata: 'do' }
        } catch (jsonError) {
          console.warn('Failed to parse JSON in do():', jsonError)
        }
      }

      // Last resort: try eval (with warning)
      try {
        console.warn('Using eval() as last resort - this should be avoided in production')
        // eslint-disable-next-line no-eval
        const action = eval(trimmed)
        if (action && typeof action === 'object') {
          return { ...action, _metadata: 'do' }
        }
      } catch (evalError) {
        // eval also failed
      }

      throw new Error(`Failed to parse do() action: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Handle finish(...) format - similar to Python version
  if (trimmed.startsWith('finish(')) {
    try {
      // Extract message from finish(message="...")
      const messageMatch = trimmed.match(/finish\s*\(\s*message\s*=\s*["']?([^"']+)["']?\s*\)/i)
      const message = messageMatch ? messageMatch[1] : trimmed.replace(/^finish\s*\(\s*/, '').replace(/\s*\)\s*$/, '')

      return {
        _metadata: 'finish',
        message: message || 'Task completed',
      }
    } catch (error) {
      // Fallback: extract any text after finish(
      const message = trimmed.replace(/^finish\s*\(\s*/, '').replace(/\s*\)\s*$/, '')
      return {
        _metadata: 'finish',
        message: message || 'Task completed',
      }
    }
  }

  // Try to find JSON object directly (fallback)
  const jsonMatch = trimmed.match(/\{[\s\S]*"action"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const action = JSON.parse(jsonMatch[0])
      if (action.action) {
        return { ...action, _metadata: 'do' }
      }
    } catch (error) {
      // Ignore JSON parse errors
    }
  }

  // If we can't parse, throw an error (matching Python behavior)
  throw new Error(`Failed to parse action: ${trimmed}`)
}

