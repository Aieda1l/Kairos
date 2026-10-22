import 'server-only';
import type {UserScope} from '@/lib/auth/user-scope';
import type {Assignment} from '@/lib/assignments/types';
import type {CalendarEventLink} from '@/lib/calendar/types';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {D1AssignmentRepository} from './assignments';
import {D1CalendarEventLinkRepository} from './calendar-event-links';
import {D1SettingsRepository} from './settings';

export type CalendarInputs={assignments:Assignment[];hideSubmitted:boolean;links:CalendarEventLink[]};

/** Called after calendar validation inside the existing admitted reconciliation.
 * Only read inputs share a call. Owner/control checks and writes stay separate. */
export async function loadCalendarInputs(db:D1DatabaseLike,scope:UserScope,connectionId:string):Promise<CalendarInputs>{
  const assignments=new D1AssignmentRepository(db,scope).prepareCalendarList(connectionId);
  const hideSubmitted=new D1SettingsRepository(db,scope).prepareCalendarHideSubmitted();
  const links=new D1CalendarEventLinkRepository(db,scope).prepareListByConnection(connectionId);
  const results=await db.batch([assignments.statement,hideSubmitted.statement,links.statement]);
  if(results.length!==3||results.some(result=>!result||result.success!==true||!Array.isArray(result.results))){
    throw new Error('Calendar inputs could not be loaded.');
  }
  return {assignments:assignments.read(results[0]!),hideSubmitted:hideSubmitted.read(results[1]!),links:links.read(results[2]!)};
}
