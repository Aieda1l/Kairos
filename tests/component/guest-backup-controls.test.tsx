// @vitest-environment jsdom
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {GuestProvider,useGuestStoreLifecycle} from "@/features/guest/guest-provider";
import {GuestBackupControls} from "@/features/guest/guest-backup-controls";
import {useEffect} from "react";
import {serializeGuestBackup} from "@/lib/guest/backup";
import {GUEST_MAX_IMPORT_BYTES} from "@/lib/guest/limits";
import {guestSnapshotFixture,guestUuid} from "../helpers/guest-fixtures";
import {guestStoreFake} from "../helpers/guest-store-fake";

beforeEach(()=>{vi.stubGlobal("fetch",vi.fn().mockRejectedValue(Error("offline private detail")));});
function setup({corrupt=false,unknown=false,abort=false}={}){
  const before=guestSnapshotFixture(),fake=guestStoreFake(before),events:string[]=[];
  const clear=vi.fn(async()=>{events.push("clear");if(abort)throw Error("quota private detail");const saved={...before,datasetId:guestUuid(90),connections:[],assignments:[],statuses:[],syncStates:[]};fake.replace(saved);return saved;});
  fake.store.clear=clear;
  fake.store.replaceDataset=vi.fn(async backup=>{events.push("replace");if(abort)throw Error("quota private detail");const saved={...before,...backup.data,datasetId:guestUuid(91)};fake.replace(saved);return saved;});
  if(corrupt)vi.mocked(fake.store.read).mockRejectedValueOnce(Error("bad graph"));
  if(unknown)vi.mocked(fake.store.getIdentity).mockRejectedValue(Error("bad metadata"));
  function Observer(){const lifecycle=useGuestStoreLifecycle();useEffect(()=>{if(!lifecycle)return;events.push("acquired");return lifecycle.onRetire(()=>{expect(lifecycle.isActive()).toBe(false);events.push("retired");});},[lifecycle]);return null;}
  const factory=async()=>fake.store;
  render(<GuestProvider storeFactory={factory}><Observer/><GuestBackupControls/></GuestProvider>);
  return {before,...fake,clear,events};
}
function file(text:string,size?:number){const f=new File([text],"backup.json",{type:"application/json"});Object.defineProperty(f,"text",{configurable:true,writable:true,value:async()=>text});if(size)Object.defineProperty(f,"size",{value:size});return f;}
const backup=()=>serializeGuestBackup(guestSnapshotFixture(),"2026-10-24T12:00:00.000Z");
it.each(["{malformed",'{"schemaVersion":2}',JSON.stringify({...JSON.parse(backup()),data:{...JSON.parse(backup()).data,connections:[]}})])("rejects invalid imports without changing accepted data: %s",async text=>{
  const fake=setup();await userEvent.upload(await screen.findByLabelText("Import guest backup"),file(text));
  expect(await screen.findByRole("alert")).toHaveTextContent(/backup.*invalid|version.*unsupported/i);
  expect(await fake.store.read()).toEqual(fake.before);expect(fake.store.replaceDataset).not.toHaveBeenCalled();expect(fake.events).toEqual(["acquired"]);
});
it("rejects an oversized File before reading it",async()=>{
  const fake=setup(),f=file("{}",GUEST_MAX_IMPORT_BYTES+1),read=vi.spyOn(f,"text");
  await userEvent.upload(await screen.findByLabelText("Import guest backup"),f);expect(await screen.findByRole("alert")).toHaveTextContent(/10 MiB/);expect(read).not.toHaveBeenCalled();expect(await fake.store.read()).toEqual(fake.before);
});
it("previews before replacement and retires old consumers before the atomic write",async()=>{
  const fake=setup();await userEvent.upload(await screen.findByLabelText("Import guest backup"),file(backup()));
  expect(screen.getByText(/1 source.*0 courses.*1 assignment/i)).toBeVisible();expect(fake.store.replaceDataset).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"Replace local data"}));await screen.findByText(/Backup imported/);
  expect(fake.events.slice(0,3)).toEqual(["acquired","retired","replace"]);expect((await fake.store.read()).datasetId).not.toBe(fake.before.datasetId);
});
it("exports only the public coursework graph",async()=>{
  setup();const create=vi.fn<(blob:Blob)=>string>().mockReturnValue("blob:backup"),revoke=vi.fn();Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  await userEvent.click(await screen.findByRole("button",{name:"Export guest backup"}));
  const text=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.readAsText(create.mock.calls[0][0]);});
  expect(JSON.parse(text).data).not.toHaveProperty("credentials");expect(text).not.toMatch(/"(datasetId|revision|capability|lease|requests)":/);expect(revoke).toHaveBeenCalled();
});
it("clears locally after confirmation even when session end fails, without account requests",async()=>{
  const fake=setup();await userEvent.click(await screen.findByRole("button",{name:"Clear guest data"}));expect(fake.clear).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button",{name:"Confirm clear guest data"}));await screen.findByText(/Guest data cleared/);expect((await fake.store.read()).assignments).toEqual([]);
  expect(screen.getByRole("button",{name:"Clear guest data"})).toHaveFocus();
  expect(fake.events.slice(0,3)).toEqual(["acquired","retired","clear"]);expect(vi.mocked(fetch).mock.calls.map(c=>c[0])).toEqual(["/api/guest/session/end"]);
});
it("recovers a corrupt graph using known metadata on the owned store",async()=>{
  const fake=setup({corrupt:true});await userEvent.click(await screen.findByRole("button",{name:"Clear guest data"}));await userEvent.click(screen.getByRole("button",{name:"Confirm clear guest data"}));await screen.findByText(/Guest data cleared/);expect(fake.clear).toHaveBeenCalledWith(fake.before.datasetId);expect(fake.store.close).not.toHaveBeenCalled();
});
it("does not offer unsafe reset when metadata cannot be read",async()=>{
  const fake=setup({unknown:true});await screen.findByText(/browser.*site data settings/i);expect(screen.queryByRole("button",{name:"Clear guest data"})).not.toBeInTheDocument();expect(fake.clear).not.toHaveBeenCalled();
});
it("revokes recovery identity when previously readable metadata becomes unreadable",async()=>{
  const fake=setup();await screen.findByRole("button",{name:"Clear guest data"});
  vi.mocked(fake.store.getIdentity).mockRejectedValue(Error("corrupt metadata"));await act(async()=>fake.notify());
  await screen.findByText(/Browser storage identity could not be read/);expect(screen.queryByRole("button",{name:"Clear guest data"})).not.toBeInTheDocument();expect(fake.events).toEqual(["acquired","retired"]);
});
it("keeps accepted data after storage abort and publishes a fresh lifecycle",async()=>{
  const fake=setup({abort:true});await userEvent.click(await screen.findByRole("button",{name:"Clear guest data"}));await userEvent.click(screen.getByRole("button",{name:"Confirm clear guest data"}));expect(await screen.findByRole("alert")).toHaveTextContent(/could not.*saved|could not.*changed/i);
  await waitFor(()=>expect(fake.events).toEqual(["acquired","retired","clear","acquired"]));expect(await fake.store.read()).toEqual(fake.before);expect(fetch).not.toHaveBeenCalled();expect(screen.queryByText(/Guest data cleared/)).not.toBeInTheDocument();
  await act(async()=>fake.notify());
});
