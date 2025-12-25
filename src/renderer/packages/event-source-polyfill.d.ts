/**
 * Type declarations for event-source-polyfill
 */

declare module 'event-source-polyfill' {
  export interface EventSourcePolyfillInit {
    withCredentials?: boolean
    headers?: Record<string, string>
    heartbeatTimeout?: number
  }

  export class EventSourcePolyfill extends EventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourcePolyfillInit)
    close(): void
  }
}

