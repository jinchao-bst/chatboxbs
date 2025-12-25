/**
 * BlueStacks operations wrapper - replaces ADB operations
 */

import type { BluestacksConfig } from '../bluestacksClient'
import * as bsClient from '../bluestacksClient'

export interface Screenshot {
  base64Data: string
  width: number
  height: number
  isSensitive?: boolean
}

export interface DeviceInfo {
  instanceId: string
  name: string
  status: 'running' | 'stopped' | 'error'
  androidVersion?: string
  ipAddress?: string
}

// Screenshot call counter for debugging
let screenshotCallCount = 0

export function getScreenshotCallCount(): number {
  return screenshotCallCount
}

export function resetScreenshotCallCount(): void {
  screenshotCallCount = 0
}

/**
 * Get screenshot from BlueStacks instance
 */
export async function getScreenshot(
  cfg: BluestacksConfig,
  sessionId: string,
  opts?: { gridEnabled?: boolean }
): Promise<Screenshot> {
  screenshotCallCount++
  console.log(`[Screenshot] Call #${screenshotCallCount} - sessionId: ${sessionId}`)
  try {
    const result = await bsClient.screenshot(cfg, sessionId, opts ? { grid_enabled: opts.gridEnabled } : undefined)
    if (result.status === 'success' && result.data?.screenshot_base64) {
      // Get actual image dimensions from base64
      const dimensions = await getImageDimensions(result.data.screenshot_base64)
      
      return {
        base64Data: result.data.screenshot_base64,
        width: dimensions.width,
        height: dimensions.height,
        isSensitive: false,
      }
    }
    throw new Error(result.error || 'Screenshot failed')
  } catch (error) {
    console.error('Screenshot error:', error)
    // Return fallback black image
    return createFallbackScreenshot()
  }
}

/**
 * Get image dimensions from base64 string
 */
function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = (error) => {
      console.warn('Failed to load image for dimensions, using defaults:', error)
      // Fallback to common Android screen dimensions
      resolve({ width: 1080, height: 2400 })
    }
    img.src = `data:image/png;base64,${base64}`
  })
}

/**
 * Tap at coordinates
 */
export async function tap(
  cfg: BluestacksConfig,
  sessionId: string,
  x: number,
  y: number,
  delay: number = 1000
): Promise<void> {
  const result = await bsClient.tap(cfg, sessionId, x, y)
  if (result.status !== 'success') {
    throw new Error(result.error || 'Tap failed')
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Swipe from start to end coordinates
 */
export async function swipe(
  cfg: BluestacksConfig,
  sessionId: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs?: number,
  delay: number = 1000
): Promise<void> {
  // Calculate duration if not provided
  if (!durationMs) {
    const distSq = (startX - endX) ** 2 + (startY - endY) ** 2
    durationMs = Math.max(1000, Math.min(Math.floor(distSq / 1000), 2000))
  }

  const result = await bsClient.swipe(cfg, sessionId, startX, startY, endX, endY, durationMs)
  if (result.status !== 'success') {
    throw new Error(result.error || 'Swipe failed')
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Type text into current input field
 */
export async function typeText(
  cfg: BluestacksConfig,
  sessionId: string,
  text: string,
  delay: number = 1000
): Promise<void> {
  const result = await bsClient.inputText(cfg, sessionId, text)
  if (result.status !== 'success') {
    throw new Error(result.error || 'Type text failed')
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Clear text in current input field
 */
export async function clearText(cfg: BluestacksConfig, sessionId: string): Promise<void> {
  // BlueStacks SDK might not have direct clear_text, use backspace or select all + delete
  // For now, we'll use inputText with empty string or implement via key events
  // This is a placeholder - actual implementation depends on BlueStacks SDK capabilities
  await new Promise((resolve) => setTimeout(resolve, 500))
}

/**
 * Press back button
 */
export async function back(cfg: BluestacksConfig, sessionId: string, delay: number = 1000): Promise<void> {
  const result = await bsClient.back(cfg, sessionId)
  if (result.status !== 'success') {
    throw new Error(result.error || 'Back failed')
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Press home button
 */
export async function home(cfg: BluestacksConfig, sessionId: string, delay: number = 1000): Promise<void> {
  const result = await bsClient.home(cfg, sessionId)
  if (result.status !== 'success') {
    throw new Error(result.error || 'Home failed')
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
}

/**
 * Double tap at coordinates
 */
export async function doubleTap(
  cfg: BluestacksConfig,
  sessionId: string,
  x: number,
  y: number,
  delay: number = 1000
): Promise<void> {
  await tap(cfg, sessionId, x, y, 100)
  await new Promise((resolve) => setTimeout(resolve, 100))
  await tap(cfg, sessionId, x, y, delay)
}

/**
 * Long press at coordinates
 */
export async function longPress(
  cfg: BluestacksConfig,
  sessionId: string,
  x: number,
  y: number,
  durationMs: number = 3000,
  delay: number = 1000
): Promise<void> {
  // Long press is implemented as swipe from (x,y) to (x,y) with duration
  await swipe(cfg, sessionId, x, y, x, y, durationMs, delay)
}

/**
 * Launch app by package name and activity
 * Uses BlueStacks SDK /v1/tools/start_app API
 * 
 * @param packageName - Android package name (e.g., "com.android.settings")
 * @param activity - Activity class name (e.g., ".Settings" or "com.android.settings.Settings")
 *                   If not provided, will try to infer from common patterns
 */
export async function launchApp(
  cfg: BluestacksConfig,
  sessionId: string,
  packageName: string,
  activity?: string,
  delay: number = 2000
): Promise<boolean> {
  // If activity not provided, try to infer it
  // Common pattern: if package is "com.example.app", activity might be ".MainActivity" or "com.example.app.MainActivity"
  let finalActivity = activity
  if (!finalActivity) {
    // Try common activity patterns
    const packageParts = packageName.split('.')
    const appName = packageParts[packageParts.length - 1]
    // Try ".MainActivity" first, then full qualified name
    finalActivity = `.${appName.charAt(0).toUpperCase() + appName.slice(1)}Activity`
  }

  const result = await bsClient.startApp(cfg, sessionId, packageName, finalActivity)
  if (result.status !== 'success') {
    throw new Error(result.error || `Failed to launch app: ${packageName}`)
  }
  await new Promise((resolve) => setTimeout(resolve, delay))
  return true
}

/**
 * Get current app name
 * Note: This might need to be implemented via BlueStacks SDK if available
 */
export async function getCurrentApp(cfg: BluestacksConfig, sessionId: string): Promise<string> {
  // This would need to be implemented based on BlueStacks SDK capabilities
  // For now, return placeholder
  return 'System Home'
}

/**
 * Like latest Instagram post
 * Calls the Instagram task API endpoint
 * 
 * @param cfg - BlueStacks configuration
 * @param sessionId - Session ID
 * @param options - Optional options including custom baseUrl (default: http://localhost:8081)
 */
export async function likeLatestInstagramPost(
  cfg: BluestacksConfig,
  sessionId: string,
  options?: { baseUrl?: string }
): Promise<{ status: 'success' | 'failure'; output?: string; data?: any; error?: string; message?: string }> {
  const result = await bsClient.likeLatestPost(cfg, sessionId, options)
  if (result.status !== 'success') {
    throw new Error(result.error || result.message || 'Like latest post failed')
  }
  return result
}

/**
 * Quick test function for likeLatestInstagramPost API
 * Can be called from browser console: window.testLikeLatestPost('session-id')
 */
export async function testLikeLatestPost(sessionId: string, baseUrl: string = 'http://localhost:8081') {
  console.log('🧪 Testing likeLatestInstagramPost API...')
  console.log('Session ID:', sessionId)
  console.log('Base URL:', baseUrl)
  
  try {
    const cfg: BluestacksConfig = { baseUrl: 'http://localhost:8080' } // Default config, will be overridden
    const result = await likeLatestInstagramPost(cfg, sessionId, { baseUrl })
    
    console.log('✅ Success!')
    console.log('Result:', result)
    return result
  } catch (error) {
    console.error('❌ Error:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
    }
    throw error
  }
}

/**
 * Create fallback black screenshot
 */
function createFallbackScreenshot(): Screenshot {
  // Create a minimal black PNG base64 (1x1 pixel)
  const blackPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  return {
    base64Data: blackPngBase64,
    width: 1080,
    height: 2400,
    isSensitive: false,
  }
}

