import { z } from 'zod'

export const roleSchema = z.enum(['admin', 'teacher', 'student', 'guardian'])
export type Role = z.infer<typeof roleSchema>

export const switchContextBody = z.strictObject({
  schoolId: z.string().uuid(),
  role: roleSchema,
})
export type SwitchContextBody = z.infer<typeof switchContextBody>

export const meContextSchema = z.object({
  schoolId: z.string().uuid(),
  role: roleSchema,
  schoolName: z.string(),
})

export const meSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  contexts: z.array(meContextSchema),
  activeContext: z.object({
    schoolId: z.string().uuid(),
    role: roleSchema,
  }),
  csrfToken: z.string(),
})
export type Me = z.infer<typeof meSchema>

export const logoutResponseSchema = z.object({
  endSessionUrl: z.string().url(),
})
export type LogoutResponse = z.infer<typeof logoutResponseSchema>

export { parseModuleDraft, moduleDraftInput, moduleDraftStored, type ModuleDraftInput, type ModuleDraftStored, type DraftParse } from './json/module-draft.ts'
export { parseRichText, paragraph, type RichDoc, type RichParse } from './json/rich-text.ts'
