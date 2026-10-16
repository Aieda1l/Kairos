import {expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {ownedFetch,withOwnedOperation} from '@/lib/abuse/operation-lock';
import type {D1DatabaseLike,D1PreparedStatementLike} from '@/lib/db/d1/types';

it.each(['allowed','paused','storage-failure'] as const)('checks concurrent work together without reusing a settled %s decision',async mode=>{
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
      expect(checks).toBe(1);
      if(mode==='paused')test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
      release();
      const results=await Promise.allSettled(calls);
      if(mode==='allowed'){
        expect(results.every(r=>r.status==='fulfilled')).toBe(true);
        expect(transport).toHaveBeenCalledTimes(6);
        // A later call must read the control again, even for the same owner.
        test.sqlite.prepare("UPDATE abuse_controls SET enabled=0,version=version+1 WHERE control_key='provider:canvas'").run();
        await expect(ownedFetch(transport)('https://synthetic.invalid/')).rejects.toMatchObject({code:'ABUSE_STORAGE_UNAVAILABLE'});
        expect(checks).toBe(2);
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
