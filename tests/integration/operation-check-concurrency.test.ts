import {expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {ownedFetch,withOwnedOperation} from '@/lib/abuse/operation-lock';
import type {D1DatabaseLike,D1PreparedStatementLike} from '@/lib/db/d1/types';
import {createCalendarAdapterFactory} from '@/lib/calendar/provider-factory';
import {guardCalendarAdapter} from '@/lib/calendar/adapter';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1CalendarCredentialRepository} from '@/lib/db/d1/repositories/calendar-credentials';

it.each(['allowed','paused','storage-failure'] as const)('checks concurrent work without reusing a settled %s decision',async mode=>{
  const test=openD1TestDatabase();
  try{
    const scope={userId:'synthetic-concurrent'};
    test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);
    let checks=0,release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const wrap=(sql:string,statement:D1PreparedStatementLike):D1PreparedStatementLike=>({
      bind:(...values)=>wrap(sql,statement.bind(...values)),all:()=>statement.all(),run:()=>statement.run(),
      first:async<T>()=>{
        if(sql.startsWith('SELECT (SELECT enabled FROM abuse_controls')){
          checks++;await gate;
          if(mode==='storage-failure')throw new Error('Synthetic unavailable storage');
        }
        return statement.first<T>();
      },
    });
    const db:D1DatabaseLike={prepare:sql=>wrap(sql,test.db.prepare(sql)),batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db)};
    const transport=vi.fn<typeof fetch>(async()=>Response.json({ok:true}));
    const work=withOwnedOperation(db,scope,'source:canvas',async()=>{
      const calls=Array.from({length:6},()=>ownedFetch(transport)('https://synthetic.invalid/'));
      await vi.waitFor(()=>expect(checks).toBeGreaterThan(0));
      if(mode==='paused')test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
      release();
      expect(checks).toBe(6);
      const results=await Promise.allSettled(calls);
      if(mode==='allowed'){
        expect(results.every(r=>r.status==='fulfilled')).toBe(true);
        expect(transport).toHaveBeenCalledTimes(6);
        // A later call must read the control again, even for the same owner.
        test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
        await expect(ownedFetch(transport)('https://synthetic.invalid/')).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
        expect(checks).toBe(7);
        expect(transport).toHaveBeenCalledTimes(6);
      }else{
        expect(results.every(r=>r.status==='rejected'&&r.reason.code==='ABUSE_STORAGE_UNAVAILABLE')).toBe(true);
        expect(transport).not.toHaveBeenCalled();
      }
    });
    await expect(work).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
    expect(test.sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
  }finally{test.close();}
});

it.each(['google','microsoft'] as const)('keeps the native %s transport fenced after adapter construction',async provider=>{
  const test=openD1TestDatabase();
  try{
    const scope={userId:'synthetic-native-'+provider},keyring={activeKeyId:'fixture',keys:{fixture:new Uint8Array(32).fill(9)}};
    test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);
    const connections=new D1CalendarConnectionRepository(test.db,scope);
    const created=await connections.create({provider,label:'Synthetic'});
    const connection=await connections.updateRemoteCalendar(created.id,'synthetic-calendar','Kairos');
    await new D1CalendarCredentialRepository(test.db,scope,keyring).setOAuthRefreshToken(connection.id,'synthetic-refresh');
    const transport=vi.fn<typeof fetch>(async()=>Response.json({access_token:'synthetic-access',expires_in:3600}));
    const factory=createCalendarAdapterFactory(test.db,scope,keyring,{fetchImpl:transport,env:{GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',MICROSOFT_CALENDAR_CLIENT_ID:'00000000-0000-4000-8000-000000000001',MICROSOFT_CALENDAR_CLIENT_SECRET:'synthetic-secret'}});
    await expect(withOwnedOperation(test.db,scope,`calendar:${provider}`,async()=>{
      const adapter=guardCalendarAdapter(await factory(connection));
      test.sqlite.prepare('UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key=?').run('provider:'+provider);
      await adapter.testConnection();
    })).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
    expect(transport).toHaveBeenCalledTimes(1); // Only the already-settled token request.
  }finally{test.close();}
});

it('does not join a validation whose database snapshot predates the new call',async()=>{
  const test=openD1TestDatabase();
  let release!:()=>void;
  try{
    const scope={userId:'synthetic-late-check'};
    test.sqlite.prepare('INSERT INTO users(id) VALUES (?)').run(scope.userId);
    let checks=0;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const wrap=(sql:string,statement:D1PreparedStatementLike):D1PreparedStatementLike=>({
      bind:(...values)=>wrap(sql,statement.bind(...values)),all:()=>statement.all(),run:()=>statement.run(),
      first:async<T>()=>{
        const row=await statement.first<T>();
        if(sql.startsWith('SELECT (SELECT enabled FROM abuse_controls')&&++checks===1)await gate;
        return row;
      },
    });
    const db:D1DatabaseLike={prepare:sql=>wrap(sql,test.db.prepare(sql)),batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db)};
    const transport=vi.fn<typeof fetch>(async()=>Response.json({ok:true}));
    const work=withOwnedOperation(db,scope,'source:canvas',async()=>{
      const first=ownedFetch(transport)('https://synthetic.invalid/first');
      await vi.waitFor(()=>expect(checks).toBe(1));
      test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
      let lateError:unknown;
      const later=ownedFetch(transport)('https://synthetic.invalid/later').catch(error=>{lateError=error;});
      try{
        await vi.waitFor(()=>expect(lateError).toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'}),{timeout:200});
        expect(checks).toBe(2);
        expect(transport).not.toHaveBeenCalled();
      }finally{
        release();await Promise.allSettled([first,later]);
      }
      expect(transport).toHaveBeenCalledTimes(1);
    });
    await expect(work).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
  }finally{release?.();test.close();}
});
