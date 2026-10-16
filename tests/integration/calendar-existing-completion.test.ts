import {afterEach,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {installProviderRuntime} from '../helpers/provider-runtime';
import {withOwnedOperation} from '@/lib/abuse/operation-lock';
import {D1CalendarEventLinkRepository} from '@/lib/db/d1/repositories/calendar-event-links';
import {reconcileCalendarConnection} from '@/lib/calendar/reconcile';

afterEach(()=>vi.restoreAllMocks());

function seed(){
  const test=openD1TestDatabase();
  test.sqlite.exec(`
    INSERT INTO users(id) VALUES ('alice'),('bob');
    INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at) VALUES ('alice','source-a','canvas','Synthetic','2026','2026'),('bob','source-b','canvas','Synthetic','2026','2026');
    INSERT INTO assignments(user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES
      ('alice','assignment-a','source-a','canvas','a','Synthetic','Synthetic','pending','2026','2026','2026','2026'),
      ('alice','assignment-a2','source-a','canvas','a2','Synthetic','Synthetic','pending','2026','2026','2026','2026'),
      ('bob','assignment-b','source-b','canvas','b','Synthetic','Synthetic','pending','2026','2026','2026','2026');
    INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at) VALUES ('alice','google-a','google','Synthetic','2026','2026'),('alice','google-other','google','Synthetic','2026','2026'),('bob','google-b','google','Synthetic','2026','2026');
    INSERT INTO calendar_event_links(user_id,id,calendar_connection_id,assignment_id,sync_key,remote_event_id,content_hash,created_at,updated_at) VALUES
      ('alice','link-a','google-a','assignment-a','key-a','event-a','old','2026','2026'),
      ('alice','link-a2','google-a','assignment-a2','key-a2','event-a2','old','2026','2026'),
      ('bob','link-b','google-b','assignment-b','key-b','event-b','old','2026','2026');
  `);
  return test;
}
const write=(id:string)=>({id,remoteEventId:'event-'+id.slice(5),remoteEtag:null,contentHash:'new',syncedAt:'2026-10-16T00:00:00.000Z'});

it('updates only existing mappings in the owned tenant and destination',async()=>{
  const test=seed();
  try{
    const scope={userId:'alice'},repo=new D1CalendarEventLinkRepository(test.db,scope);
    await withOwnedOperation(test.db,scope,'calendar:google',async()=>{
      expect(await repo.markExistingSyncedMany('google-a',[write('link-a')])).toBe(1);
      expect(await repo.markExistingSyncedMany('google-a',[write('link-b'),write('missing')])).toBe(0);
      expect(await repo.markExistingSyncedMany('google-other',[write('link-a')])).toBe(0);
      await expect(new D1CalendarEventLinkRepository(test.db,{userId:'bob'}).markExistingSyncedMany('google-b',[write('link-b')])).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});
    });
    expect(test.sqlite.prepare('SELECT id,content_hash FROM calendar_event_links ORDER BY id').all()).toEqual([{id:'link-a',content_hash:'new'},{id:'link-a2',content_hash:'old'},{id:'link-b',content_hash:'old'}]);
  }finally{test.close();}
});

it('retains all mapping metadata when a chunk update fails',async()=>{
  const test=seed();
  try{
    test.sqlite.exec("CREATE TRIGGER fail_existing BEFORE UPDATE ON calendar_event_links WHEN NEW.content_hash='reject' BEGIN SELECT RAISE(ABORT,'Synthetic completion failure'); END");
    const scope={userId:'alice'},repo=new D1CalendarEventLinkRepository(test.db,scope);
    await expect(withOwnedOperation(test.db,scope,'calendar:google',()=>repo.markExistingSyncedMany('google-a',[write('link-a'),{...write('link-a2'),contentHash:'reject'}]))).rejects.toThrow('Synthetic completion failure');
    expect(test.sqlite.prepare("SELECT content_hash FROM calendar_event_links WHERE user_id='alice'").all()).toEqual([{content_hash:'old'},{content_hash:'old'}]);
  }finally{test.close();}
});

it('does not persist a completed remote update after the provider is paused',async()=>{
  const test=seed();
  try{
    const scope={userId:'alice'},repo=new D1CalendarEventLinkRepository(test.db,scope);
    await expect(withOwnedOperation(test.db,scope,'calendar:google',async()=>{
      test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:google'").run();
      expect(await repo.markExistingSyncedMany('google-a',[write('link-a')])).toBe(0);
    })).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
    expect(test.sqlite.prepare("SELECT content_hash FROM calendar_event_links WHERE id='link-a'").get()).toEqual({content_hash:'old'});
  }finally{test.close();}
});

it('retains known event IDs and uncertain ownership when their completion batch fails',async()=>{
  const test=seed();
  try{
    installProviderRuntime(test.db);
    test.sqlite.exec("UPDATE assignments SET due_at='2026-11-01T00:00:00.000Z' WHERE user_id='alice'; UPDATE calendar_connections SET remote_calendar_id='synthetic-calendar' WHERE id='google-a'; CREATE TRIGGER fail_completion BEFORE UPDATE ON calendar_event_links BEGIN SELECT RAISE(ABORT,'Synthetic completion failure'); END");
    let updated=0;
    await expect(reconcileCalendarConnection(test.db,{userId:'alice'},'google-a',{adapterFactory:async()=>({
      provider:'google',testConnection:async()=>{},ensureCalendar:async()=>({remoteCalendarId:'synthetic-calendar',name:'Kairos'}),
      getEvent:async(_calendar,id)=>({remoteEventId:id,etag:null}),
      createEvent:async()=>{throw new Error('Must not create a duplicate');},
      updateEvent:async(_calendar,id)=>{updated++;return {remoteEventId:id,etag:null};},deleteEvent:async()=>{},
    })})).rejects.toMatchObject({code:'SYNC_RECOVERY_REQUIRED'});
    expect(updated).toBe(2);
    expect(test.sqlite.prepare("SELECT remote_event_id,content_hash FROM calendar_event_links WHERE user_id='alice' ORDER BY id").all()).toEqual([{remote_event_id:'event-a',content_hash:'old'},{remote_event_id:'event-a2',content_hash:'old'}]);
    expect(test.sqlite.prepare("SELECT state FROM operation_locks WHERE user_id='alice'").get()).toEqual({state:'uncertain'});
  }finally{test.close();}
});
