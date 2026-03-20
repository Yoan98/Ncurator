import { z } from 'zod/v4'
import type { HumanResult } from '../../types'

export const mouthResultSchema: z.ZodType<HumanResult> = z.object({
  status: z.enum(['completed', 'blocked']),
  summary: z.string().min(1),
  deliveryMarkdown: z.string().min(1)
})
