import {z} from 'zod';

export const SYNC_ALL_STEPS=['canvas-deadlines','canvas-submissions','gradescope','ed','calendars'] as const;
export type SyncAllStep=typeof SYNC_ALL_STEPS[number];
export type SyncAllOptions={deferCalendarSync?:boolean;syncAllRunId?:string};
export const syncAllAdmissionSchema=z.object({
  runId:z.string().uuid(),
  expiresAt:z.string().datetime(),
  steps:z.array(z.enum(SYNC_ALL_STEPS)).max(SYNC_ALL_STEPS.length),
}).strict().refine(value=>new Set(value.steps).size===value.steps.length);
export type SyncAllAdmission=z.infer<typeof syncAllAdmissionSchema>;
export const MAX_CALENDAR_INVOCATIONS=100;
export const calendarInvocationsSchema=z.object({
  invocations:z.array(z.object({connectionId:z.string().min(1).max(256),runId:z.string().uuid()}).strict()).max(MAX_CALENDAR_INVOCATIONS),
}).strict().refine(value=>new Set(value.invocations.map(i=>i.connectionId)).size===value.invocations.length
  &&new Set(value.invocations.map(i=>i.runId)).size===value.invocations.length);
