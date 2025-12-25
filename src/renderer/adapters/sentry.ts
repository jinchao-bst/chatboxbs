import * as Sentry from '@sentry/react'
import { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/**
 * 渲染进程的 Sentry 适配器实现
 * Disabled for internal debug builds - no Sentry reporting
 */
export class RendererSentryAdapter implements SentryAdapter {
  captureException(error: any): void {
    // Disabled for internal debug builds - no Sentry reporting
    // Sentry.captureException(error)
  }

  withScope(callback: (scope: SentryScope) => void): void {
    // Disabled for internal debug builds - no Sentry reporting
    // Create a no-op scope to avoid errors
    const scope: SentryScope = {
      setTag(key: string, value: string): void {
        // No-op
      },
      setExtra(key: string, value: any): void {
        // No-op
      },
    }
    callback(scope)
    // Sentry.withScope((sentryScope) => {
    //   const scope: SentryScope = {
    //     setTag(key: string, value: string): void {
    //       sentryScope.setTag(key, value)
    //     },
    //     setExtra(key: string, value: any): void {
    //       sentryScope.setExtra(key, value)
    //     },
    //   }
    //   callback(scope)
    // })
  }
} 