// @vitest-environment jsdom
import {StrictMode,useEffect} from "react";
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {GuestProvider,useGuest,useGuestStoreLifecycle,useGuestDatasetChange} from "@/features/guest/guest-provider";
import {guestSnapshot,guestStoreFake} from "../helpers/guest-store-fake";

it("publishes only the owned hydrated store and retires consumers before dataset replacement and close",async()=>{
  const fake=guestStoreFake();const events:string[]=[];const handles:unknown[]=[];
  vi.mocked(fake.store.close).mockImplementation(()=>{events.push("close");});
  function Consumer(){const lifecycle=useGuestStoreLifecycle();useEffect(()=>{
    if(!lifecycle)return;handles.push(lifecycle.store);events.push("acquired:"+lifecycle.datasetId);
    return lifecycle.onRetire(()=>{expect(lifecycle.isActive()).toBe(false);events.push("retired");});
  },[lifecycle]);return null;}
  const factory=async()=>fake.store;
  const view=render(<GuestProvider storeFactory={factory}><Consumer/><Preferences/></GuestProvider>);
  await screen.findByText("Asia/Tokyo");await waitFor(()=>expect(handles).toEqual([fake.store]));
  await act(async()=>fake.replace({...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"}));
  expect(events).toEqual(["acquired:"+guestSnapshot().datasetId,"retired","acquired:22222222-2222-4222-8222-222222222222"]);
  expect(fake.store.close).not.toHaveBeenCalled();view.unmount();expect(events.slice(-2)).toEqual(["retired","close"]);expect(handles).toEqual([fake.store,fake.store]);
});

function Preferences(){
  const guest=useGuest();
  if(guest.phase!=="ready")return <p>{guest.phase}</p>;
  return <><input aria-label="Preference search" value={guest.snapshot.preferences.filters.search} onChange={e=>{void guest.savePreferences({filters:{...guest.snapshot.preferences.filters,search:e.target.value}});}}/><span>{guest.snapshot.preferences.timeZone}</span>{guest.actionError&&<p role="alert">{guest.actionError}</p>}</>;
}

it("subscribes before hydration, skips lease-only reads, and notices a new dataset at the same revision",async()=>{
  const fake=guestStoreFake();
  render(<GuestProvider storeFactory={async()=>fake.store}><Preferences/></GuestProvider>);
  await screen.findByText("Asia/Tokyo");
  expect(vi.mocked(fake.store.subscribe).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fake.store.read).mock.invocationCallOrder[0]);
  const reads=vi.mocked(fake.store.read).mock.calls.length;
  await act(async()=>fake.notify());
  expect(fake.store.read).toHaveBeenCalledTimes(reads);
  await act(async()=>fake.replace({...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222",preferences:{...guestSnapshot().preferences,timeZone:"Europe/London"}}));
  await screen.findByText("Europe/London");
  expect(fake.store.readRememberedSecret).not.toHaveBeenCalled();
});

it("keeps rapid edits and reports failed persistence without claiming the value was saved",async()=>{
  const fake=guestStoreFake();
  const save=vi.mocked(fake.store.savePreferences).getMockImplementation()!;
  vi.mocked(fake.store.savePreferences).mockImplementation(async(...args)=>{await new Promise(resolve=>setTimeout(resolve,15));return save(...args);});
  render(<GuestProvider storeFactory={async()=>fake.store}><Preferences/></GuestProvider>);
  const input=await screen.findByLabelText("Preference search");
  await userEvent.type(input,"homework");
  await waitFor(()=>expect(fake.store.savePreferences).toHaveBeenCalledTimes(8));
  await waitFor(()=>expect(input).toHaveValue("homework"));
  await waitFor(async()=>expect((await fake.store.read()).preferences.filters.search).toBe("homework"));
  vi.mocked(fake.store.savePreferences).mockRejectedValueOnce(Error("secret remote detail"));
  await userEvent.type(input,"!");
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be saved/i);
  expect(screen.queryByText(/secret remote detail/)).not.toBeInTheDocument();
  await waitFor(()=>expect(input).toHaveValue("homework"));
});

it("closes late stores and suppresses obsolete reads on cleanup including StrictMode",async()=>{
  const first=guestStoreFake(),second=guestStoreFake();
  let resolve!:(store:typeof first.store)=>void;
  const factory=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue(second.store);
  const view=render(<StrictMode><GuestProvider storeFactory={factory}><Preferences/></GuestProvider></StrictMode>);
  await screen.findByText("Asia/Tokyo");
  await act(async()=>resolve(first.store));
  expect(first.store.close).toHaveBeenCalledOnce();
  expect(second.store.close).not.toHaveBeenCalled();
  view.unmount();
  expect(second.store.close).toHaveBeenCalledOnce();
});

it("does not lose hydration when a lease notification arrives during the first read",async()=>{
  const fake=guestStoreFake();
  let resolve!:(snapshot:ReturnType<typeof guestSnapshot>)=>void;
  vi.mocked(fake.store.read).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  render(<GuestProvider storeFactory={async()=>fake.store}><Preferences/></GuestProvider>);
  await waitFor(()=>expect(fake.store.read).toHaveBeenCalledOnce());
  await act(async()=>fake.notify());
  await screen.findByText("Asia/Tokyo");
  await act(async()=>resolve({...guestSnapshot(),preferences:{...guestSnapshot().preferences,timeZone:"Europe/London"}}));
  expect(screen.getByText("Asia/Tokyo")).toBeInTheDocument();
});

it("keeps a storage read failure visible when an in-flight preference write also fails",async()=>{
  const fake=guestStoreFake();
  let rejectSave!:(error:Error)=>void;
  vi.mocked(fake.store.savePreferences).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectSave=reject;}));
  render(<GuestProvider storeFactory={async()=>fake.store}><Preferences/></GuestProvider>);
  await userEvent.type(await screen.findByLabelText("Preference search"),"x");
  vi.mocked(fake.store.getIdentity).mockResolvedValue({datasetId:guestSnapshot().datasetId,revision:1});
  vi.mocked(fake.store.read).mockRejectedValueOnce(Error("corrupt coursework"));
  await act(async()=>fake.notify());
  await screen.findByText("error");
  await act(async()=>rejectSave(Error("write failed")));
  expect(screen.getByText("error")).toBeInTheDocument();
  expect(screen.queryByLabelText("Preference search")).not.toBeInTheDocument();
});

it.each(["success","abort"] as const)("rehydrates a retired lifecycle when a lease notification supersedes the post-reset read: %s",async outcome=>{
  const fake=guestStoreFake(),factory=async()=>fake.store;
  let change!:ReturnType<typeof useGuestDatasetChange>,lifecycle!:ReturnType<typeof useGuestStoreLifecycle>;
  function Consumer(){
    const value=useGuestDatasetChange(),owned=useGuestStoreLifecycle(),guest=useGuest();
    useEffect(()=>{change=value;lifecycle=owned;},[value,owned]);
    return <p>{guest.phase==="ready"?guest.snapshot.datasetId:guest.phase}</p>;
  }
  render(<GuestProvider storeFactory={factory}><Consumer/></GuestProvider>);
  await screen.findByText(guestSnapshot().datasetId);const retired=lifecycle!;
  const saved=outcome==="success"?{...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"}:guestSnapshot();
  fake.store.clear=vi.fn(async()=>{if(outcome==="abort")throw Error("native write abort");fake.replace(saved);return saved;});
  let finishIdentity!:(identity:{datasetId:string;revision:number})=>void;
  vi.mocked(fake.store.getIdentity).mockImplementationOnce(()=>new Promise(resolve=>{finishIdentity=resolve;}));
  let pending!:Promise<boolean>;await act(async()=>{pending=change(null,guestSnapshot().datasetId);});
  await waitFor(()=>expect(finishIdentity).toBeDefined());expect(retired.isActive()).toBe(false);
  // A late old-run release can notify with unchanged coursework metadata while
  // the explicit reset's forced hydration is still awaiting its metadata read.
  await act(async()=>fake.notify());
  await act(async()=>{finishIdentity({datasetId:saved.datasetId,revision:saved.revision});expect(await pending).toBe(outcome==="success");});
  expect(lifecycle?.isActive()).toBe(true);expect(lifecycle).not.toBe(retired);
  expect(lifecycle?.datasetId).toBe(saved.datasetId);expect(screen.getByText(saved.datasetId)).toBeVisible();
});
