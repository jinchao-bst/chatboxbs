import { useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useEffect, useRef } from 'react'
import type { CopilotDetail } from 'src/shared/types'
import * as remote from '@/packages/remote'
import storage, { StorageKey } from '@/storage'
import { useLanguage } from '@/stores/settingsStore'

// Default Bluestacks copilot definition
const BLUESTACKS_COPILOT_ID = 'bluestacks-copilot'

const defaultBluestacksCopilot: CopilotDetail = {
  id: BLUESTACKS_COPILOT_ID,
  name: 'Bluestacks Assistant',
  picUrl: 'https://cdn-www.bluestacks.com/bs-images/favicon.png',
  prompt:
    'You are a "BlueStacks Mobile Assistant" that helps users complete various automation tasks on Android devices through the BlueStacks emulator.\n\n' +
    'Users will describe tasks in natural language, such as "Open Settings and connect to Wi-Fi", "Search for a game in the app store and install it", etc.\n\n' +
    'When user instructions require actual operations on the phone, please follow PhoneAgent specifications, use `<think>...</think>` and `<answer>...</answer>` to wrap your thinking process and next operation instructions, ' +
    'and use `do(action=\"...\", ...)` / `finish(message=\"...\")` format to describe specific actions to be executed on the phone.\n\n' +
    'If the current message is just a regular chat request (no phone operations needed), you can answer like a regular chat assistant.',
  demoQuestion: 'Help me open the "Settings" app on my phone.',
  demoAnswer:
    '<think>I need to open the system Settings app through BlueStacks. First, check if we are on the home screen. If not, I can return to the desktop first, then click the "Settings" icon.</think>\n' +
    '<answer>do(action=\"Launch\", app=\"Settings\")</answer>',
  starred: true,
  usedCount: 0,
}

// Default SNS copilot definition
const SNS_COPILOT_ID = 'sns-copilot'

const defaultSNSCopilot: CopilotDetail = {
  id: SNS_COPILOT_ID,
  name: 'SNS Assistant',
  picUrl: 'https://cdn-www.bluestacks.com/bs-images/favicon.png', // Instagram icon
  prompt:
    'You are an "SNS Assistant" that helps users complete various automation tasks on Instagram, such as liking posts, following users, etc.\n\n' +
    'Users will describe tasks in natural language, such as "Like @username\'s latest post", "Follow @username", etc.\n\n' +
    'When users mention Instagram operations like liking or following, I will automatically execute the corresponding automation tasks.\n\n' +
    'If the current message is just a regular chat request, you can answer like a regular chat assistant.',
  demoQuestion: 'Like @instagram\'s latest post',
  demoAnswer: 'Okay, I will like @instagram\'s latest post for you.',
  starred: true,
  usedCount: 0,
}

// Default BlueStacks Chat Assistant copilot definition
const BLUESTACKS_CHAT_ASSISTANT_ID = 'bluestacks-chat-assistant'

const defaultBluestacksChatAssistant: CopilotDetail = {
  id: BLUESTACKS_CHAT_ASSISTANT_ID,
  name: 'BlueStacks Chat Assistant',
  picUrl: 'https://cdn-www.bluestacks.com/bs-images/favicon.png',
  prompt:
    'You are a friendly AI assistant that uses BlueStacks LLM to answer user questions.\n\n' +
    'You can help users answer various questions, have conversations, provide information and suggestions.\n\n' +
    'Please communicate with users in a natural and friendly tone, providing accurate and useful answers.',
  demoQuestion: 'Hello, please introduce yourself',
  demoAnswer: 'Hello! I am an AI assistant that uses BlueStacks LLM to help you answer questions and have conversations. I can answer various questions, provide information and suggestions. Is there anything I can help you with?',
  starred: true,
  usedCount: 0,
}

const myCopilotsAtom = atomWithStorage<CopilotDetail[]>(StorageKey.MyCopilots, [], storage)

export function useMyCopilots() {
  const [copilots, setCopilots] = useAtom(myCopilotsAtom)

  // Only keep default copilots, remove all others
  // Use a ref to track if we've already cleaned up to avoid infinite loops
  const cleanedUpRef = useRef(false)
  
  useEffect(() => {
    // Skip if already cleaned up
    if (cleanedUpRef.current) {
      return
    }
    
    // Always set to only default copilots
    const defaultCopilots = [defaultBluestacksCopilot, defaultSNSCopilot, defaultBluestacksChatAssistant]
    
    // Check if current copilots match defaults (only check IDs to avoid deep comparison)
    const copilotIds = new Set(copilots.map(c => c.id))
    const defaultIds = new Set(defaultCopilots.map(c => c.id))
    const hasOnlyDefaults = 
      copilots.length === defaultCopilots.length &&
      copilotIds.size === defaultIds.size &&
      Array.from(copilotIds).every(id => defaultIds.has(id))
    
    if (!hasOnlyDefaults) {
      // Replace all copilots with defaults only
      cleanedUpRef.current = true
      // Use setTimeout to avoid blocking render
      setTimeout(() => {
        setCopilots(defaultCopilots)
      }, 0)
    } else {
      cleanedUpRef.current = true
    }
  }, []) // Empty deps - only run once on mount

  const addOrUpdate = (target: CopilotDetail) => {
    setCopilots((copilots) => {
      let found = false
      const newCopilots = copilots.map((c) => {
        if (c.id === target.id) {
          found = true
          return target
        }
        return c
      })
      if (!found) {
        newCopilots.push(target)
      }
      return newCopilots
    })
  }

  const remove = (id: string) => {
    setCopilots((copilots) => copilots.filter((c) => c.id !== id))
  }

  return {
    copilots,
    addOrUpdate,
    remove,
  }
}

export function useRemoteCopilots() {
  const language = useLanguage()
  const { data: copilots, ...others } = useQuery({
    queryKey: ['remote-copilots', language],
    queryFn: () => remote.listCopilots(language),
    initialData: [],
    initialDataUpdatedAt: 0,
    staleTime: 3600 * 1000,
    retry: false, // Disable retry to prevent infinite API calls
    refetchOnWindowFocus: false, // Disable refetch on window focus
    refetchOnReconnect: false, // Disable refetch on reconnect
  })
  return { copilots: copilots || [], ...others }
}
