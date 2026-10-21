import {afterEach,beforeEach,expect,it} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1SyncAllRunRepository} from '@/lib/db/d1/repositories/sync-all-runs';
import {AbuseSubjectError} from '@/lib/abuse/types';

let test:ReturnType<typeof openD1TestDatabase>;
const alice={userId:'alice'},bob={userId:'bob'};
beforeEach(()=>{test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('alice'),('bob')");});
afterEach(()=>test.close());
it('binds a single-use calendar invocation to its tenant and destination',async()=>{
  const google=await new D1CalendarConnectionRepository(test.db,alice).create({provider:'google',label:'Google'});
  const microsoft=await new D1CalendarConnectionRepository(test.db,alice).create({provider:'microsoft',label:'Microsoft'});
  const runs=new D1SyncAllRunRepository(test.db,alice),runId=crypto.randomUUID();
  await runs.createCalendarStep(runId,google.id);
  await expect(new D1SyncAllRunRepository(test.db,bob).claimCalendarStep(runId,google.id)).rejects.toBeInstanceOf(AbuseSubjectError);
  await expect(runs.claimCalendarStep(runId,microsoft.id)).rejects.toBeInstanceOf(AbuseSubjectError);
  await expect(runs.claim(runId,'calendars')).rejects.toBeInstanceOf(AbuseSubjectError);
  await runs.claimCalendarStep(runId,google.id);
  await expect(runs.claimCalendarStep(runId,google.id)).rejects.toBeInstanceOf(AbuseSubjectError);
});
it('rejects expired tickets, disabled destinations and a general Sync All run used as a ticket',async()=>{
  const google=await new D1CalendarConnectionRepository(test.db,alice).create({provider:'google',label:'Google'});
  const runs=new D1SyncAllRunRepository(test.db,alice),expired=crypto.randomUUID(),disabled=crypto.randomUUID(),general=crypto.randomUUID();
  await runs.createCalendarStep(expired,google.id);
  test.sqlite.prepare('UPDATE sync_all_runs SET expires_at_ms=0 WHERE run_id=?').run(expired);
  await expect(runs.claimCalendarStep(expired,google.id)).rejects.toBeInstanceOf(AbuseSubjectError);
  await runs.create(general,['calendars']);
  await expect(runs.claimCalendarStep(general,google.id)).rejects.toBeInstanceOf(AbuseSubjectError);
  await runs.createCalendarStep(disabled,google.id);
  test.sqlite.prepare('UPDATE calendar_connections SET enabled=0 WHERE id=?').run(google.id);
  await expect(runs.claimCalendarStep(disabled,google.id)).rejects.toBeInstanceOf(AbuseSubjectError);
});
it('identifies source changes newer than a completed calendar sync without inline provider work',async()=>{
  const google=await new D1CalendarConnectionRepository(test.db,alice).create({provider:'google',label:'Google'});
  test.sqlite.prepare("INSERT INTO source_connections(user_id,id,kind,label,last_sync_completed_at,created_at,updated_at) VALUES ('alice','source','ed','Ed','2026-10-21T12:00:00.000Z','2026-10-21T12:00:00.000Z','2026-10-21T12:00:00.000Z')").run();
  const row=await new D1CalendarConnectionRepository(test.db,alice).getById(google.id);
  expect(row?.sourceSyncAt).toBe('2026-10-21T12:00:00.000Z');
  expect(await new D1CalendarConnectionRepository(test.db,bob).getById(google.id)).toBeNull();
});
it('admits exactly one concurrent consumer of a destination ticket',async()=>{
  const google=await new D1CalendarConnectionRepository(test.db,alice).create({provider:'google',label:'Google'});
  const runs=new D1SyncAllRunRepository(test.db,alice),runId=crypto.randomUUID();
  await runs.createCalendarStep(runId,google.id);
  const results=await Promise.allSettled([runs.claimCalendarStep(runId,google.id),runs.claimCalendarStep(runId,google.id)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
});
