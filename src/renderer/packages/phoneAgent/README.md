# PhoneAgent - AI-Powered Phone Automation

TypeScript implementation of phone automation agent for Chatbox, using BlueStacks SDK instead of ADB.

## Overview

This package provides a complete phone automation framework that:
- Uses AI vision-language models to understand screen content
- Performs actions like tapping, swiping, typing, etc. via BlueStacks SDK
- Executes tasks step-by-step until completion

## Architecture

### Core Components

1. **PhoneAgent** (`agent.ts`) - Main orchestrator
   - Manages the automation loop
   - Captures screenshots and gets screen state
   - Calls AI model for decision making
   - Executes actions via ActionHandler

2. **ActionHandler** (`actionHandler.ts`) - Action executor
   - Parses AI model outputs into actions
   - Executes actions (tap, swipe, type, etc.)
   - Handles confirmations and takeovers

3. **BlueStacks Operations** (`bluestacks.ts`) - Device control
   - Wraps BlueStacks SDK API calls
   - Provides device operations (screenshot, tap, swipe, etc.)
   - Replaces ADB operations from original Python implementation

## Usage

### Basic Example

```typescript
import { PhoneAgent, type AgentConfig } from '@/packages/phoneAgent'
import type { BluestacksConfig } from '@/packages/bluestacksClient'

// Configure BlueStacks connection
const bsConfig: BluestacksConfig = {
  baseUrl: 'http://localhost:8080', // BlueStacks agent server URL
}

// Configure agent
const agentConfig: AgentConfig = {
  maxSteps: 100,
  instanceId: 'your-instance-id', // Optional: specific BlueStacks instance
  lang: 'cn', // or 'en'
  verbose: true,
}

// Create agent
const agent = new PhoneAgent(bsConfig, agentConfig, {
  onStepResult: (result) => {
    console.log('Step result:', result)
  },
  confirmationCallback: async (message) => {
    // Handle sensitive operations
    return confirm(message)
  },
  takeoverCallback: async (message) => {
    // Handle manual intervention requests
    alert(message)
  },
})

// Run a task
try {
  await agent.initialize()
  const result = await agent.run('打开微信并发送消息给John', {
    // LLM config for BlueStacks agent server
    provider: 'openai',
    model: 'gpt-4-vision-preview',
    api_key: 'your-api-key',
  })
  console.log('Task completed:', result)
} finally {
  await agent.close()
}
```

### Step-by-Step Control

```typescript
// Execute steps manually
const step1 = await agent.step('打开设置应用')
console.log('Step 1:', step1)

const step2 = await agent.step() // Continue from previous state
console.log('Step 2:', step2)
```

## Integration with Chatbox

To integrate PhoneAgent into Chatbox sessions:

1. **Create a custom session handler** that detects BlueStacks-related tasks
2. **Use PhoneAgent** to execute automation tasks
3. **Update session messages** with step results

Example integration:

```typescript
// In sessionActions.ts or similar
import { PhoneAgent } from '@/packages/phoneAgent'

async function handleBluestacksTask(sessionId: string, task: string) {
  const bsConfig = getBluestacksConfig() // From settings
  const agent = new PhoneAgent(bsConfig, { lang: 'cn' })
  
  try {
    await agent.initialize()
    
    // Stream results to session
    const result = await agent.run(task, getLLMConfig())
    
    // Add result message to session
    await addMessage(sessionId, {
      role: 'assistant',
      content: `任务完成: ${result}`,
    })
  } finally {
    await agent.close()
  }
}
```

## Configuration

### BlueStacks Agent Server

The PhoneAgent requires a running BlueStacks Agent Server (from `ap-ai-agent`). Default URL: `http://localhost:8080`

### LLM Configuration

When calling `agent.run()`, provide LLM configuration for the BlueStacks agent server:

```typescript
const llmConfig = {
  provider: 'openai', // or other supported providers
  model: 'gpt-4-vision-preview',
  api_key: 'your-api-key',
  base_url: 'https://api.openai.com/v1', // Optional
}
```

## Supported Actions

- **Tap** - Tap at coordinates
- **Swipe** - Swipe from start to end
- **Type** - Type text into input field
- **Back** - Press back button
- **Home** - Press home button
- **Double Tap** - Double tap at coordinates
- **Long Press** - Long press at coordinates
- **Launch** - Launch app by package name
- **Wait** - Wait for specified duration
- **Take_over** - Request manual intervention
- **Note** - Record content (placeholder)
- **Call_API** - Call API (placeholder)
- **Interact** - Request user interaction

## Differences from Python Version

1. **No ADB** - Uses BlueStacks SDK HTTP API instead
2. **TypeScript/Node.js** - Pure TypeScript implementation
3. **Integrated with Chatbox** - Designed to work within Chatbox's session system
4. **BlueStacks Agent Server** - Relies on Python agent server for LLM orchestration

## Notes

- Screenshot dimensions are currently defaulted (1080x2400). In production, decode the image to get actual dimensions.
- Some operations like `launchApp` and `getCurrentApp` are placeholders and need BlueStacks SDK implementation.
- The agent uses BlueStacks Agent Server's task streaming for model responses.

