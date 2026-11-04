import {afterEach,expect,it,vi} from "vitest";
import {createGuestCredentials} from "@/lib/guest/credentials";
import {guestSnapshotFixture} from "../helpers/guest-fixtures";

afterEach(()=>vi.unstubAllGlobals());
it("isolates memory by generation and checks remembered reads against current connection",async()=>{
  vi.stubGlobal("fetch",()=>{throw Error("Network forbidden");});
  let snapshot=guestSnapshotFixture();
  const store={read:async()=>snapshot,readRememberedSecret:async()=>"remembered"};
  const vault=createGuestCredentials(store),id=snapshot.connections[0].id;
  vault.put(id,1,"memory");
  expect(await vault.get(id,1)).toBe("memory");
  expect(await vault.get(id,2)).toBeNull();
  vault.forget(id);
  expect(await vault.get(id,1)).toBe("remembered");
  snapshot={...snapshot,connections:[]};
  expect(await vault.get(id,1)).toBeNull();
  vault.put(id,1,"stale");vault.clear();
  expect(await vault.get(id,1)).toBeNull();
});
it("does not return a remembered secret after a concurrent generation change",async()=>{
  let snapshot=guestSnapshotFixture();
  const vault=createGuestCredentials({read:async()=>snapshot,readRememberedSecret:async()=>{
    snapshot={...snapshot,connections:snapshot.connections.map(c=>({...c,generation:2}))};return "old";
  }});
  expect(await vault.get(snapshot.connections[0].id,1)).toBeNull();
});
it("an obsolete lookup does not erase a newly accepted memory credential",async()=>{
  const snapshot=guestSnapshotFixture();snapshot.connections[0].generation=2;
  const vault=createGuestCredentials({read:async()=>snapshot,readRememberedSecret:async()=>null}),id=snapshot.connections[0].id;
  vault.put(id,2,"current");expect(await vault.get(id,1)).toBeNull();expect(await vault.get(id,2)).toBe("current");
});
it("clear invalidates an already pending remembered-secret lookup",async()=>{
  const snapshot=guestSnapshotFixture();let settle!:(value:string)=>void;
  const vault=createGuestCredentials({read:async()=>snapshot,readRememberedSecret:()=>new Promise(resolve=>{settle=resolve;})});
  const pending=vault.get(snapshot.connections[0].id,1);await Promise.resolve();await Promise.resolve();
  vault.clear();settle("old");expect(await pending).toBeNull();
});
