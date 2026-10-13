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
