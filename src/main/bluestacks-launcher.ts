/**
 * BlueStacks Launcher - Start BlueStacks AI Agent Server
 */

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const BLUESTACKS_AI_PATH_WIN = 'C:\\Program Files\\BlueStacks_nxt\\BlueStacksAI.exe'
const BLUESTACKS_AI_PATH_MAC = '/Applications/BlueStacks.app/Contents/MacOS/BlueStacksAI'

/**
 * Get BlueStacks AI executable path based on platform
 */
function getBluestacksAIPath(): string | null {
  const platform = os.platform()
  
  if (platform === 'win32') {
    // Try default path
    if (fs.existsSync(BLUESTACKS_AI_PATH_WIN)) {
      return BLUESTACKS_AI_PATH_WIN
    }
    
    // Try to find in common locations
    const commonPaths = [
      'C:\\Program Files\\BlueStacks_nxt\\BlueStacksAI.exe',
      'C:\\Program Files (x86)\\BlueStacks_nxt\\BlueStacksAI.exe',
      path.join(os.homedir(), 'AppData\\Local\\Programs\\BlueStacks_nxt\\BlueStacksAI.exe'),
    ]
    
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return p
      }
    }
  } else if (platform === 'darwin') {
    if (fs.existsSync(BLUESTACKS_AI_PATH_MAC)) {
      return BLUESTACKS_AI_PATH_MAC
    }
  }
  
  return null
}

/**
 * Check if BlueStacksAI process is running
 */
export function isBluestacksAIRunning(): boolean {
  const platform = os.platform()
  const processName = platform === 'win32' ? 'BlueStacksAI.exe' : 'BlueStacksAI'
  
  try {
    const { execSync } = require('child_process')
    if (platform === 'win32') {
      const result = execSync(`tasklist /FI "IMAGENAME eq ${processName}"`, { encoding: 'utf-8' })
      return result.includes(processName)
    } else if (platform === 'darwin' || platform === 'linux') {
      const result = execSync(`pgrep -f ${processName}`, { encoding: 'utf-8' })
      return result.trim().length > 0
    }
  } catch (error) {
    // Process not found
    return false
  }
  
  return false
}

/**
 * Start BlueStacks AI Agent Server
 */
export async function startBluestacksAI(): Promise<{ success: boolean; message: string }> {
  // Check if already running
  if (isBluestacksAIRunning()) {
    return { success: true, message: 'BlueStacks AI Agent Server is already running' }
  }
  
  // Get executable path
  const exePath = getBluestacksAIPath()
  if (!exePath) {
    return {
      success: false,
      message: `BlueStacks AI Agent Server not found. Please install BlueStacks or specify the path manually.\n\n` +
        `Expected locations:\n` +
        `Windows: C:\\Program Files\\BlueStacks_nxt\\BlueStacksAI.exe\n` +
        `macOS: /Applications/BlueStacks.app/Contents/MacOS/BlueStacksAI`,
    }
  }
  
  try {
    // Start the process
    const platform = os.platform()
    if (platform === 'win32') {
      // Windows: use spawn with detached process
      spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      }).unref()
    } else {
      // macOS/Linux: use spawn
      spawn(exePath, [], {
        detached: true,
        stdio: 'ignore',
      }).unref()
    }
    
    // Wait a bit for the process to start
    await new Promise((resolve) => setTimeout(resolve, 2000))
    
    // Verify it's running
    if (isBluestacksAIRunning()) {
      return { success: true, message: 'BlueStacks AI Agent Server started successfully' }
    } else {
      return {
        success: false,
        message: 'BlueStacks AI Agent Server process started but may not be ready yet. Please wait a few seconds and try again.',
      }
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to start BlueStacks AI Agent Server: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

