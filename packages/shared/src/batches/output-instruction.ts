/**
 * Generates system prompt instructions for the batch_output tool.
 * Injected into batch sessions so the agent knows to call batch_output
 * with structured data matching the configured schema.
 */

import type { BatchContext } from './types.ts'

export function generateBatchOutputInstruction(context: BatchContext): string {
  const parts: string[] = [
    '<batch_output_instructions>',
    'You are processing a batch item. When you have produced the final result,',
    'you MUST call the `batch_output` tool with a JSON object containing your output.',
    '',
    `Batch ID: ${context.batchId}`,
    `Item ID: ${context.itemId}`,
  ]

  if (context.outputSchema) {
    parts.push('')
    parts.push('Your output MUST conform to this JSON Schema:')
    parts.push('```json')
    parts.push(JSON.stringify(context.outputSchema, null, 2))
    parts.push('```')

    // Extract field descriptions if available
    const properties = (context.outputSchema as Record<string, unknown>).properties as
      | Record<string, { description?: string }> | undefined
    if (properties) {
      parts.push('')
      parts.push('Field descriptions:')
      for (const [field, def] of Object.entries(properties)) {
        if (def.description) {
          parts.push(`- **${field}**: ${def.description}`)
        }
      }
    }
  }

  parts.push('')
  parts.push('IMPORTANT: Always call `batch_output` exactly once with your structured result.')
  parts.push('Do NOT output the result as plain text — it must go through the tool.')
  parts.push('</batch_output_instructions>')

  return parts.join('\n')
}
