import { z } from "zod";

export const edIdentifierSchema=z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/),
]);

export const edUserPayloadSchema=z.object({
  user:z.unknown(),
  courses:z.array(z.unknown()),
}).passthrough();

export const edEnrollmentSchema=z.object({
  course:z.object({
    id:edIdentifierSchema.optional(),
    code:z.string().nullish(),
    name:z.string().nullish(),
    year:z.union([z.string(),z.number()]).nullish(),
    session:z.string().nullish(),
  }).passthrough(),
  role:z.object({role:z.string().nullish()}).passthrough().optional(),
}).passthrough();

export const edLessonsPayloadSchema=z.object({
  modules:z.array(z.unknown()).optional().default([]),
  lessons:z.array(z.unknown()),
}).passthrough();

export const edLessonSchema=z.object({
  id:edIdentifierSchema.optional(),
  course_id:edIdentifierSchema.optional(),
  module_id:edIdentifierSchema.optional(),
  title:z.string().nullish(),
  status:z.string().nullish(),
  state:z.string().nullish(),
  is_hidden:z.boolean().optional(),
  is_unlisted:z.boolean().optional(),
  available_at:z.string().nullish(),
  effective_available_at:z.string().nullish(),
  due_at:z.string().nullish(),
  effective_due_at:z.string().nullish(),
  updated_at:z.string().nullish(),
}).passthrough();
