import {describe,expect,it} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../helpers/legacy-db";
import {migrate} from "../helpers/legacy-db";
import {AssignmentRepository} from "@/lib/db/repositories/assignments";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {CalendarConnectionRepository} from "@/lib/db/repositories/calendar-connections";
import {CalendarEventLinkRepository} from "@/lib/db/repositories/calendar-event-links";
import {SettingsRepository} from "@/lib/db/repositories/settings";
import type {CalendarDestinationAdapter,RemoteCalendarEvent} from "@/lib/calendar/adapter";
import type {CalendarEventProjection} from "@/lib/calendar/projection";
import {CalendarSyncError} from "@/lib/calendar/errors";
import {reconcileAllCalendars,reconcileCalendarConnection} from "@/lib/calendar/reconcile";

class FakeAdapter implements CalendarDestinationAdapter{
  readonly provider="google" as const;
  events=new Map<string,{event:RemoteCalendarEvent;projection:CalendarEventProjection;syncKey:string}>();
  byKey=new Map<string,string>();
  ensureCalls=0; createCalls=0; updateCalls=0; deleteCalls=0; active=0; maxActive=0;
  updateEtags:Array<string|null|undefined>=[];
  calendarMissing=false; loseNextCreate=false; failAll=false; failTitles=new Set<string>();
  async testConnection(){if(this.calendarMissing)throw new CalendarSyncError("CALENDAR_REMOTE_CALENDAR_MISSING","missing");}
  async ensureCalendar(){this.ensureCalls++;return {remoteCalendarId:"remote-calendar",name:"Kairos"};}
  async getEvent(_c:string,id:string){return this.events.get(id)?.event??null;}
  async findEventByAssignment(_c:string,assignmentId:string){
    for(const value of this.events.values()){
      if(value.event.managedAssignmentId===assignmentId)return value.event;
    }
    return null;
  }
  private async enter(){this.active++;this.maxActive=Math.max(this.maxActive,this.active);await new Promise(r=>setTimeout(r,2));return()=>{this.active--;};}
  async createEvent(_c:string,p:CalendarEventProjection,key:string){const leave=await this.enter();try{
    this.createCalls++; if(this.failAll||this.failTitles.has(p.title))throw new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","create failed");
    const known=this.byKey.get(key);if(known&&this.events.has(known))return this.events.get(known)!.event;
    const id="remote-"+key.slice(0,16);const event={remoteEventId:id,etag:"create-etag",managedAssignmentId:p.assignmentId};this.byKey.set(key,id);this.events.set(id,{event,projection:p,syncKey:key});
    if(this.loseNextCreate){this.loseNextCreate=false;throw new CalendarSyncError("CALENDAR_NETWORK_ERROR","lost response");}return event;
  }finally{leave();}}
  async updateEvent(_c:string,id:string,p:CalendarEventProjection,etag?:string|null){const leave=await this.enter();try{
    this.updateCalls++;this.updateEtags.push(etag);if(this.failAll||this.failTitles.has(p.title))throw new CalendarSyncError("CALENDAR_UPSTREAM_ERROR","update failed");
    const old=this.events.get(id)!;const event={remoteEventId:id,etag:"update-"+this.updateCalls,managedAssignmentId:p.assignmentId};this.events.set(id,{event,projection:p,syncKey:old.syncKey});return event;
  }finally{leave();}}
  async deleteEvent(_c:string,id:string){this.deleteCalls++;this.events.delete(id);}
}

const row=(id:string,title:string,dueAt:string|null)=>({source:"canvas" as const,externalId:id,courseId:"123",courseName:"CSE 331",title,releaseAt:null,dueAt,lateDueAt:null,status:"pending" as const,sourceStatusText:"Not submitted",gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:`https://canvas.uw.edu/courses/123/assignments/${id}`,sourceUpdatedAt:null});
function setup(rows=[row("1","Homework 1","2026-10-09T06:59:00.000Z")]){const db=openDatabase(":memory:");migrate(db);const source=new SourceConnectionRepository(db).upsertCanvas("Canvas");new AssignmentRepository(db).upsertMany(source.id,rows,"2026-10-06T00:00:00.000Z");const repo=new CalendarConnectionRepository(db);const c=repo.create({provider:"google",label:"Google"},new Date("2026-10-06T00:00:00Z"));repo.updateRemoteCalendar(c.id,"remote-calendar","Kairos",new Date("2026-10-06T00:00:01Z"));return {db,c:repo.getById(c.id)!,adapter:new FakeAdapter()};}
const run=(db:Database.Database,id:string,a:FakeAdapter,extra:{concurrency?:number}={})=>reconcileCalendarConnection(db,id,{adapterFactory:async()=>a,now:new Date("2026-10-06T01:00:00Z"),...extra});

describe("calendar reconciliation",()=>{
  it("creates once then leaves an unchanged remote event alone",async()=>{const {db,c,adapter}=setup();expect(await run(db,c.id,adapter)).toMatchObject({status:"success",createdCount:1,failedCount:0});const link=new CalendarEventLinkRepository(db).listByConnection(c.id)[0]!;expect(link.remoteEventId).toBeTruthy();expect(adapter.ensureCalls).toBe(0);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",unchangedCount:1,createdCount:0,updatedCount:0});expect(adapter.createCalls).toBe(1);expect(adapter.updateCalls).toBe(0);db.close();});
  it("updates the same event when the projection changes",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const links=new CalendarEventLinkRepository(db);const before=links.listByConnection(c.id)[0]!;db.prepare("UPDATE assignments SET title=?,due_at=?,source_status_text=? WHERE id=?").run("Homework revised","2026-10-10T06:59:00.000Z","Submitted",before.assignmentId);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",updatedCount:1});const after=links.get(c.id,before.assignmentId)!;expect(after.remoteEventId).toBe(before.remoteEventId);expect(after.contentHash).not.toBe(before.contentHash);expect(adapter.updateEtags).toEqual(["create-etag"]);db.close();});
  it("deletes only when the existing local assignment becomes undated",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const link=new CalendarEventLinkRepository(db).listByConnection(c.id)[0]!;db.prepare("UPDATE assignments SET due_at=NULL WHERE id=?").run(link.assignmentId);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",deletedCount:1});expect(adapter.deleteCalls).toBe(1);expect(new CalendarEventLinkRepository(db).listByConnection(c.id)).toEqual([]);db.close();});
  it("removes a generated event when an assignment becomes submitted by default, then restores it if reopened",async()=>{
    const {db,c,adapter}=setup();
    await run(db,c.id,adapter);
    const link=new CalendarEventLinkRepository(db).listByConnection(c.id)[0]!;
    db.prepare("UPDATE assignments SET status='submitted',source_status_text='Submitted' WHERE id=?").run(link.assignmentId);
    expect(await run(db,c.id,adapter)).toMatchObject({
      status:"success",
      deletedCount:1,
      createdCount:0,
    });
    expect(new CalendarEventLinkRepository(db).listByConnection(c.id)).toEqual([]);
    expect(adapter.events.size).toBe(0);

    db.prepare("UPDATE assignments SET status='pending',source_status_text='Not submitted' WHERE id=?").run(link.assignmentId);
    expect(await run(db,c.id,adapter)).toMatchObject({
      status:"success",
      createdCount:1,
      deletedCount:0,
    });
    expect(adapter.events.size).toBe(1);
    db.close();
  });

  it("keeps submitted assignment events when hide-submitted is disabled",async()=>{
    const {db,c,adapter}=setup();
    await run(db,c.id,adapter);
    const link=new CalendarEventLinkRepository(db).listByConnection(c.id)[0]!;
    new SettingsRepository(db).setCalendarHideSubmitted(false);
    db.prepare("UPDATE assignments SET status='submitted',source_status_text='Submitted' WHERE id=?").run(link.assignmentId);
    expect(await run(db,c.id,adapter)).toMatchObject({
      status:"success",
      updatedCount:1,
      deletedCount:0,
    });
    expect(adapter.events.size).toBe(1);
    db.close();
  });

  it("recreates a deleted event with the same sync key",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const links=new CalendarEventLinkRepository(db);const before=links.listByConnection(c.id)[0]!;adapter.events.delete(before.remoteEventId!);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",createdCount:1});const after=links.get(c.id,before.assignmentId)!;expect(after.syncKey).toBe(before.syncKey);expect(adapter.events.size).toBe(1);db.close();});
  it("converges after a lost create response without duplication",async()=>{const {db,c,adapter}=setup();adapter.loseNextCreate=true;expect(await run(db,c.id,adapter)).toMatchObject({status:"error",failedCount:1,errorCode:"CALENDAR_NETWORK_ERROR"});const links=new CalendarEventLinkRepository(db);const before=links.listByConnection(c.id)[0]!;expect(before.remoteEventId).toBeNull();expect(adapter.events.size).toBe(1);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",createdCount:1});expect(links.get(c.id,before.assignmentId)!.syncKey).toBe(before.syncKey);expect(adapter.events.size).toBe(1);db.close();});
  it("adopts an existing managed event when local links are lost instead of creating a duplicate",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const oldLink=new CalendarEventLinkRepository(db).listByConnection(c.id)[0]!;const repo=new CalendarConnectionRepository(db);const replacement=repo.create({provider:"google",label:"Replacement"});repo.updateRemoteCalendar(replacement.id,"remote-calendar","Kairos");db.prepare("DELETE FROM calendar_event_links WHERE calendar_connection_id=?").run(c.id);expect(adapter.events.size).toBe(1);expect(await run(db,replacement.id,adapter)).toMatchObject({status:"success",createdCount:0,updatedCount:1});expect(adapter.createCalls).toBe(1);expect(adapter.events.size).toBe(1);const adopted=new CalendarEventLinkRepository(db).listByConnection(replacement.id)[0]!;expect(adopted.remoteEventId).toBe(oldLink.remoteEventId);db.close();});
  it("tags a legacy linked event even when its visible projection is unchanged",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const links=new CalendarEventLinkRepository(db);const link=links.listByConnection(c.id)[0]!;const stored=adapter.events.get(link.remoteEventId!)!;stored.event={...stored.event,managedAssignmentId:null};adapter.events.set(link.remoteEventId!,stored);expect(await run(db,c.id,adapter)).toMatchObject({status:"success",updatedCount:1,unchangedCount:0});expect(adapter.events.get(link.remoteEventId!)!.event.managedAssignmentId).toBe(link.assignmentId);db.close();});
  it("does not silently recreate a deleted whole calendar",async()=>{const {db,c,adapter}=setup();await run(db,c.id,adapter);const before=new CalendarEventLinkRepository(db).listByConnection(c.id);adapter.calendarMissing=true;expect(await run(db,c.id,adapter)).toMatchObject({status:"error",errorCode:"CALENDAR_REMOTE_CALENDAR_MISSING"});expect(adapter.ensureCalls).toBe(0);expect(new CalendarEventLinkRepository(db).listByConnection(c.id)).toEqual(before);db.close();});
  it("records partial failures without erasing prior mappings",async()=>{const {db,c,adapter}=setup([row("1","Homework 1","2026-10-09T06:59:00Z"),row("2","Homework 2","2026-10-10T06:59:00Z")]);await run(db,c.id,adapter);const repo=new CalendarEventLinkRepository(db);const links=repo.listByConnection(c.id);const first=links[0]!;db.prepare("UPDATE assignments SET title='Bad' WHERE id=?").run(first.assignmentId);db.prepare("UPDATE assignments SET title='Good changed' WHERE id=?").run(links[1]!.assignmentId);adapter.failTitles.add("[CSE 331] Bad");expect(await run(db,c.id,adapter)).toMatchObject({status:"partial",updatedCount:1,failedCount:1,errorCode:"CALENDAR_PARTIAL_SYNC"});expect(repo.get(c.id,first.assignmentId)).toMatchObject({remoteEventId:first.remoteEventId,contentHash:first.contentHash,lastErrorCode:"CALENDAR_UPSTREAM_ERROR"});db.close();});
  it("isolates an all-event failure and another destination",async()=>{const {db,c,adapter}=setup([row("1","Homework 1","2026-10-09T06:59:00Z"),row("2","Homework 2","2026-10-10T06:59:00Z")]);adapter.failAll=true;expect(await run(db,c.id,adapter)).toMatchObject({status:"error",failedCount:2,errorCode:"CALENDAR_UPSTREAM_ERROR"});const repo=new CalendarConnectionRepository(db);const second=repo.create({provider:"google",label:"Google 2"});repo.updateRemoteCalendar(second.id,"remote-2","Kairos");const good=new FakeAdapter();const all=await reconcileAllCalendars(db,{adapterFactory:async item=>item.id===c.id?adapter:good,now:new Date("2026-10-06T01:00:00Z")});expect(all.status).toBe("partial");expect(all.results.map(r=>r.status).sort()).toEqual(["error","success"]);db.close();});
  it("does not infer deletion from stale local rows and caps concurrency at four",async()=>{const rows=Array.from({length:12},(_,i)=>row(String(i+1),`Homework ${i+1}`,`2026-10-${String(9+i).padStart(2,"0")}T06:59:00Z`));const {db,c,adapter}=setup(rows);expect(await run(db,c.id,adapter,{concurrency:99})).toMatchObject({status:"success",createdCount:12});expect(adapter.maxActive).toBeLessThanOrEqual(4);expect(adapter.maxActive).toBeGreaterThan(1);db.prepare("UPDATE assignments SET last_seen_at='2020-01-01T00:00:00Z'").run();expect(await run(db,c.id,adapter)).toMatchObject({status:"success",unchangedCount:12,deletedCount:0});expect(adapter.deleteCalls).toBe(0);db.close();});
});
