import uniq from 'lodash/uniq'
import { ofetch } from 'ofetch'
import { cache } from '../utils/cache'

// Disabled for internal debug builds - no external API access
let API_ORIGIN = 'http://localhost:8002' // Use local API if available, otherwise will fail gracefully

let POOL: string[] = [] // Empty pool to prevent API access

export function isChatboxAPI(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : (input as Request).url ?? input.toString()
  return POOL.some((o) => url.startsWith(o)) || url.startsWith(API_ORIGIN)
}

export function getChatboxAPIOrigin() {
  // Disabled for internal debug builds - return local API or empty
  if (process.env.USE_LOCAL_API) {
    return 'http://localhost:8002'
  }
  // Return localhost to prevent external API access
  // This will cause API calls to fail gracefully if local API is not available
  return 'http://localhost:8002'
}

/**
 * 按顺序测试 API 的可用性，只要有一个 API 域名可用，就终止测试并切换所有流量到该域名。
 * 在测试过程中，会根据服务器返回添加新的 API 域名，并缓存到本地
 * 
 * Disabled for internal debug builds - no external API testing
 */
export async function testApiOrigins() {
  // Disabled for internal debug builds - return empty array to prevent API access
  return []
}
