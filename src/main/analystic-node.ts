import * as store from './store-node'
import { app } from 'electron'
import { ofetch } from 'ofetch'

// Measurement Protocol 参考文档
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?hl=zh-cn&client_type=gtag
// https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events?client_type=gtag&hl=zh-cn#required_parameters

// 事件名、参数名，必须是字母、数字、下划线的组合

const measurement_id = `G-B365F44W6E`
const api_secret = `pRnsvLo-REWLVzV_PbKvWg`

// Google Analytics Measurement Protocol disabled for internal debug builds.
// Keep API shape, but do not send any network requests.
export async function event(name: string, params: any = {}) {
  void name
  void params
  void measurement_id
  void api_secret
  // no-op
  return undefined
}
