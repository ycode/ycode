import { z } from 'zod';

const name = z.string().trim().min(1).max(255);
export const cssVariableIdSchema = z.uuid();
export const cssVariableSetSchema = z.object({
  name,
  activation_kind: z.enum(['default', 'theme', 'breakpoint']).optional(),
}).strict();
export const cssVariableModeSchema = z.object({
  set_id: cssVariableIdSchema,
  name,
  is_default: z.boolean().optional(),
  data_theme: z.string().trim().max(255).regex(/^[a-zA-Z0-9_-]*$/).nullable().optional(),
  min_width: z.number().int().min(0).max(100000).nullable().optional(),
}).strict();
export const cssVariableGroupSchema = z.object({ set_id: cssVariableIdSchema, name }).strict();
export const cssVariableSchema = z.object({
  set_id: cssVariableIdSchema,
  group_id: cssVariableIdSchema.nullable().optional(),
  type: z.enum(['color', 'size', 'percentage', 'number', 'font_family']),
  name,
}).strict();
export const cssVariableValueSchema = z.object({
  css_variable_id: cssVariableIdSchema,
  mode_id: cssVariableIdSchema,
  value: z.string().max(1000),
}).strict();
export const cssVariableOrderSchema = z.array(cssVariableIdSchema).max(1000).refine(ids => new Set(ids).size === ids.length, 'Duplicate IDs');

export class CssVariableValidationError extends Error {}

export function cssVariableErrorStatus(error: unknown): number {
  return error instanceof z.ZodError || error instanceof CssVariableValidationError || error instanceof SyntaxError ? 400 : 500;
}
