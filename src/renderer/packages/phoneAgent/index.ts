/**
 * PhoneAgent - AI-powered phone automation
 * Main entry point for phone agent functionality
 */

export { PhoneAgent, type AgentConfig, type StepResult, type OnStepResult } from './agent'
export { ActionHandler, parseAction, type Action, type ActionResult } from './actionHandler'
export * as bluestacksOps from './bluestacks'
export type { Screenshot, DeviceInfo } from './bluestacks'
export { testLikeLatestPost } from './bluestacks'

