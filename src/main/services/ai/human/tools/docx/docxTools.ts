import type { DocxCapabilityToolsInput } from './types'
import { createDocxToolRuntime } from './runtime'
import { buildDocxReadTools } from './tools/readTools'
import { buildDocxWriteTools } from './tools/writeTools'
import { buildDocxDeliveryTools } from './tools/deliveryTools'

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const runtime = createDocxToolRuntime(input)

  return {
    tools: [
      ...buildDocxReadTools(runtime),
      ...buildDocxWriteTools(runtime),
      ...buildDocxDeliveryTools(runtime)
    ],
    state: runtime.state
  }
}
