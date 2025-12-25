/**
 * Quick test script for likeLatestInstagramPost API
 * 
 * Usage in browser console:
 * 1. Import the function:
 *    const { testLikeLatestPost } = await import('@/packages/phoneAgent/bluestacks')
 * 
 * 2. Call with session ID:
 *    await testLikeLatestPost('your-session-id', 'http://localhost:8081')
 * 
 * Or use the direct API call:
 *    fetch('http://localhost:8081/v1/sns/ins/tasks/like_latest_post', {
 *      method: 'POST',
 *      headers: { 'Content-Type': 'application/json' },
 *      body: JSON.stringify({ session_id: 'your-session-id' })
 *    }).then(r => r.json()).then(console.log)
 */

import { testLikeLatestPost } from './bluestacks'

// Export for use in browser console
if (typeof window !== 'undefined') {
  ;(window as any).testLikeLatestPost = testLikeLatestPost
}

export { testLikeLatestPost }

