import { z } from 'zod'

const rectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()

export const helperWindowSchema = z
  .object({
    id: z.string().regex(/^0x[0-9a-f]+$/),
    pid: z.number().int().safe().nonnegative(),
    title: z.string(),
    nativeClass: z.string().min(1).optional(),
    executablePath: z.string().min(1).optional(),
    bounds: rectSchema,
    visible: z.literal(true),
  })
  .strict()

export const helperSuccessEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict()

export const helperFailureEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        message: z.string(),
      })
      .strict(),
  })
  .strict()

export const helperEnvelopeSchema = z.discriminatedUnion('ok', [
  helperSuccessEnvelopeSchema,
  helperFailureEnvelopeSchema,
])

export type HelperWindow = z.infer<typeof helperWindowSchema>
export type HelperEnvelope = z.infer<typeof helperEnvelopeSchema>
