// @vitest-environment jsdom
import {StrictMode,useEffect} from "react";
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {GuestProvider,useGuest,useGuestStoreLifecycle} from "@/features/guest/guest-provider";
import {GuestSourcesProvider,useGuestSources} from "@/features/guest/guest-sources-provider";
import {GuestSyncControls} from "@/features/guest/guest-sync-controls";
import {GuestDataError,guestSafeMessage} from "@/lib/guest/errors";
import type {GuestSnapshot,GuestStage,GuestStageOutcome} from "@/lib/guest/types";
import {guestSnapshot,guestStoreFake} from "../helpers/guest-store-fake";

const mocks=vi.hoisted(()=>({factory:vi.fn(),bootstrap:vi.fn(),clear:vi.fn(),run:vi.fn(),stop:vi.fn(),connectCanvas:vi.fn(),restoreSecret:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/guest/sync/coordinator",()=>({createGuestSyncCoordinator:mocks.factory}));
vi.mock("@/lib/guest/credentials",()=>({createGuestCredentials:()=>({get:async()=>null,clear:mocks.clear})}));
vi.mock("@/lib/guest/sync/transient-client",()=>({createGuestTransientClient:()=>({bootstrap:mocks.bootstrap})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("next/script",()=>({default:()=>null}));
const outcome=(stage:GuestStage,patch:Partial<GuestStageOutcome>={}):GuestStageOutcome=>({runId:"r",stage,status:"success",code:null,updatedCount:1,failedCount:0,ignoredCount:0,pendingCount:0,attemptedAt:new Date().toISOString(),completedAt:new Date().toISOString(),...patch});
const report=(outcomes:GuestStageOutcome[])=>({run:{},mode:"manual",outcomes});
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Unexpected network");}));
  mocks.factory.mockReturnValue({run:mocks.run,stop:mocks.stop,connectCanvas:mocks.connectCanvas,restoreSecret:mocks.restoreSecret});mocks.run.mockResolvedValue(report([]));
  mocks.connectCanvas.mockResolvedValue({status:"success",code:null,connectionId:"c"});
  mocks.restoreSecret.mockResolvedValue({status:"success",code:null,connectionId:"c"});
});
function mount(snapshot=guestSnapshot(),children=<GuestSyncControls/>){
  const fake=guestStoreFake(snapshot);const factory=async()=>fake.store;
  return {...fake,...render(<StrictMode><GuestProvider storeFactory={factory}><GuestSourcesProvider siteKey="public-test">{children}</GuestSourcesProvider></GuestProvider></StrictMode>)};
}
it("partial Canvas does not hide successful Ed or require a Kairos account",async()=>{
  mocks.run.mockResolvedValue(report([outcome("canvas-status",{status:"partial",code:"PARTIAL_SYNC",updatedCount:9,failedCount:1}),outcome("ed",{updatedCount:4})]));
  mount();await userEvent.click(await screen.findByRole("button",{name:"Sync sources"}));
  expect(await screen.findByText(/9 of 10/)).toBeVisible();expect(screen.getByText(/Ed sync complete/)).toBeVisible();
  expect(screen.queryByText(/sign in to Kairos/i)).not.toBeInTheDocument();expect(mocks.refresh).not.toHaveBeenCalled();
});
it("shows distinct failed and pending courses rather than a false assignment denominator, and replaces current outcomes",async()=>{
  mocks.run.mockResolvedValueOnce(report([outcome("ed",{status:"partial",code:"RATE_LIMITED",updatedCount:8,failedCount:1,pendingCount:2})])).mockResolvedValueOnce(report([outcome("ed",{status:"failed",code:"ED_AUTH_INVALID",updatedCount:0,failedCount:1})]));
  mount();const button=await screen.findByRole("button",{name:"Sync sources"});await userEvent.click(button);
  expect(await screen.findByText(/8 assignments updated.*1 failed course.*2 pending courses/i)).toBeVisible();
  await userEvent.click(button);expect(await screen.findByText(/update your Ed API token/i)).toBeVisible();expect(screen.queryByText(/8 assignments updated/)).not.toBeInTheDocument();expect(screen.queryByText(/Ed sync complete/)).not.toBeInTheDocument();
});
it("includes unchanged accepted status members in the Canvas denominator",async()=>{
  mocks.run.mockResolvedValue(report([outcome("canvas-status",{updatedCount:0,ignoredCount:10})]));
  mount();await userEvent.click(await screen.findByRole("button",{name:"Sync sources"}));
  expect(await screen.findByText(/0 of 10 statuses updated.*10 unchanged/)).toBeVisible();
});
it.each(["EXTENSION_UNAVAILABLE","CANVAS_TAB_UNAVAILABLE","CANVAS_SIGNED_OUT","GRADESCOPE_TAB_UNAVAILABLE","GRADESCOPE_SIGNED_OUT"] as const)("retains data and explains %s while feed and Ed can still succeed",async code=>{
  mocks.run.mockResolvedValue(report([outcome("canvas-feed"),outcome("canvas-status",{status:"failed",code,updatedCount:0,failedCount:2}),outcome("ed")]));
  mount();await userEvent.click(await screen.findByRole("button",{name:"Sync sources"}));
  expect(await screen.findByText(/Ed sync complete/)).toBeVisible();expect(screen.getByText(/Saved coursework is retained/)).toBeVisible();
  expect(screen.getByText(guestSafeMessage(code))).toBeVisible();
  expect(screen.queryByText(/Canvas status sync complete/)).not.toBeInTheDocument();
});
it("runs stale automatic status and Gradescope once through the same coordinator under StrictMode",async()=>{
  const snapshot=guestSnapshot();snapshot.connections=[{id:"c",kind:"canvas",enabled:true,generation:1,createdAt:"",updatedAt:""},{id:"g",kind:"gradescope",enabled:true,generation:1,createdAt:"",updatedAt:""}];
  const fake=mount(snapshot);await waitFor(()=>expect(mocks.run).toHaveBeenCalledOnce());
  expect(mocks.run).toHaveBeenCalledWith({automatic:true,sources:["canvas","gradescope"]});
  const coordinatorCount=mocks.factory.mock.calls.length;await act(async()=>fake.replace({...snapshot,revision:1}));
  expect(mocks.run).toHaveBeenCalledOnce();expect(mocks.factory).toHaveBeenCalledTimes(coordinatorCount);
  await userEvent.click(screen.getByRole("button",{name:"Sync sources"}));expect(mocks.run).toHaveBeenLastCalledWith({});
});
it("uses the 15 minute successful-check rule, and retires the vault and coordinator on dataset replacement",async()=>{
  const snapshot=guestSnapshot();snapshot.connections=[{id:"c",kind:"canvas",enabled:true,generation:1,createdAt:"",updatedAt:""}];
  snapshot.syncStates=[{sourceConnectionId:"c",stage:"canvas-status",lastAttemptedAt:null,lastSuccessfulAt:new Date(Date.now()-14*60_000).toISOString(),lastErrorCode:null,updatedCount:1,failedCount:0,resumeKeys:[],hasSuccessfulCheck:true}];
  const fake=mount(snapshot);await waitFor(()=>expect(screen.getByRole("button",{name:"Sync sources"})).toBeEnabled());expect(mocks.run).not.toHaveBeenCalled();
  await act(async()=>fake.replace({...snapshot,datasetId:"22222222-2222-4222-8222-222222222222"}));
  await waitFor(()=>expect(mocks.stop).toHaveBeenCalled());expect(mocks.clear).toHaveBeenCalled();expect(fake.store.close).toHaveBeenCalledTimes(1); // the retired StrictMode acquisition only
});
it("disables manual actions while busy and rejects completion from a retired dataset",async()=>{
  let resolve!:(value:unknown)=>void;mocks.run.mockReturnValue(new Promise(r=>{resolve=r;}));
  const fake=mount();await userEvent.click(await screen.findByRole("button",{name:"Sync sources"}));expect(screen.getByRole("button",{name:/syncing/i})).toBeDisabled();
  await act(async()=>fake.replace({...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"}));
  await act(async()=>resolve(report([outcome("ed")])));expect(screen.queryByText(/Ed sync complete/)).not.toBeInTheDocument();
});
it("rejects callbacks captured by a retired dataset instead of dispatching them on the replacement",async()=>{
  let captured:ReturnType<typeof useGuestSources>|null=null;
  function Harness(){const sources=useGuestSources();useEffect(()=>{if(sources.ready&&!captured)captured=sources;},[sources]);return <GuestSyncControls/>;}
  const fake=mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(screen.getByRole("button",{name:"Sync sources"})).toBeEnabled());
  const retired=captured!;await act(async()=>fake.replace({...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"}));
  await act(async()=>{await retired.connectCanvas({value:"old-dataset-private",remember:false});await retired.run();});
  expect(mocks.connectCanvas).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();
});
it("returns an interrupted action result if its dataset retires before completion",async()=>{
  let settle!:(value:unknown)=>void;let sources:ReturnType<typeof useGuestSources>|null=null;
  mocks.connectCanvas.mockReturnValueOnce(new Promise(resolve=>{settle=resolve;}));
  function Harness(){const value=useGuestSources();useEffect(()=>{sources=value;},[value]);return <GuestSyncControls/>;}
  const fake=mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(screen.getByRole("button",{name:"Sync sources"})).toBeEnabled());
  let pending!:ReturnType<ReturnType<typeof useGuestSources>["connectCanvas"]>;
  await act(async()=>{pending=sources!.connectCanvas({value:"old-private",remember:false});});
  await act(async()=>fake.replace({...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"}));
  await act(async()=>settle({status:"success",code:null,connectionId:"retired"}));
  expect(await pending).toMatchObject({status:"failed",code:"GUEST_INTERRUPTED",connectionId:null});
});
it.each(["resolves","rejects"] as const)("retires private ownership before a replacement read %s, then reacquires only hydrated data",async resolution=>{
  let latest!:ReturnType<typeof useGuestSources>,lifecycle:ReturnType<typeof useGuestStoreLifecycle>=null;
  let finishProof!:(value:unknown)=>void,proofSignal!:AbortSignal;
  mocks.connectCanvas.mockResolvedValueOnce({status:"failed",code:"GUEST_SESSION_REQUIRED",connectionId:null});
  mocks.bootstrap.mockImplementationOnce((_input,signal:AbortSignal)=>{proofSignal=signal;return new Promise(resolve=>{finishProof=resolve;});});
  function Harness(){
    const sources=useGuestSources(),storeLifecycle=useGuestStoreLifecycle(),guest=useGuest();
    useEffect(()=>{latest=sources;lifecycle=storeLifecycle;},[sources,storeLifecycle]);
    return <><GuestSyncControls/><p data-testid="guest-phase">{guest.phase}</p></>;
  }
  const fake=mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(latest?.ready).toBe(true));
  const oldSources=latest,oldLifecycle=lifecycle!,retired=vi.fn();oldLifecycle.onRetire(retired);
  await act(async()=>{await oldSources.connectCanvas({value:"old-private-draft",remember:false});});
  let proof!:Promise<void>;await act(async()=>{proof=oldSources.verify("fixture-guest-"+crypto.randomUUID());});
  expect(proofSignal.aborted).toBe(false);
  const replacement={...guestSnapshot(),datasetId:"22222222-2222-4222-8222-222222222222"};
  let resolveRead!:(value:GuestSnapshot)=>void,rejectRead!:(error:Error)=>void;
  const hydration=new Promise<GuestSnapshot>((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});
  const atRead:{retired:boolean;stopped:boolean;cleared:boolean;proofAborted:boolean}[]=[];
  vi.mocked(fake.store.read).mockImplementation(()=>{
    atRead.push({retired:retired.mock.calls.length===1,stopped:mocks.stop.mock.calls.length===1,cleared:mocks.clear.mock.calls.length===1,proofAborted:proofSignal.aborted});
    return hydration;
  });
  const closes=vi.mocked(fake.store.close).mock.calls.length;
  await act(async()=>fake.replace(replacement));
  if(resolution==="rejects")await act(async()=>rejectRead(Error("replacement storage failure")));
  expect(atRead[0]).toEqual({retired:true,stopped:true,cleared:true,proofAborted:true});
  expect(oldLifecycle.isActive()).toBe(false);expect(lifecycle).toBeNull();expect(latest.ready).toBe(false);
  expect(mocks.factory).toHaveBeenCalledOnce();expect(fake.store.close).toHaveBeenCalledTimes(closes);
  await act(async()=>{await oldSources.connectCanvas({value:"retired-private",remember:false});await oldSources.restoreSecret("c",{value:"retired-private",remember:false});await oldSources.run();await oldSources.verify("fixture-guest-"+crypto.randomUUID());});
  expect(mocks.connectCanvas).toHaveBeenCalledOnce();expect(mocks.restoreSecret).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();expect(mocks.bootstrap).toHaveBeenCalledOnce();
  await act(async()=>{finishProof({ok:true});await proof;});expect(mocks.connectCanvas).toHaveBeenCalledOnce();
  if(resolution==="rejects"){
    expect(screen.getByTestId("guest-phase")).toHaveTextContent("error");expect(lifecycle).toBeNull();expect(latest.ready).toBe(false);expect(mocks.factory).toHaveBeenCalledOnce();
    vi.mocked(fake.store.read).mockResolvedValue(replacement);await act(async()=>fake.notify());
  }else await act(async()=>resolveRead(replacement));
  await waitFor(()=>expect(latest.ready).toBe(true));
  expect(lifecycle!.datasetId).toBe(replacement.datasetId);expect(lifecycle!.isActive()).toBe(true);expect(lifecycle).not.toBe(oldLifecycle);expect(mocks.factory).toHaveBeenCalledTimes(2);
  await act(async()=>{await latest.connectCanvas({value:"fresh-dataset-draft",remember:false});});expect(mocks.connectCanvas).toHaveBeenCalledTimes(2);
});
it.each([["setup","pagehide"],["setup","cancel"],["restore","pagehide"],["restore","cancel"]] as const)("does not revive a delayed %s rejection after %s",async(action,cancellation)=>{
    let sources!:ReturnType<typeof useGuestSources>,settle!:(value:unknown)=>void;
    const read=action==="setup"?mocks.connectCanvas:mocks.restoreSecret;
    read.mockReturnValueOnce(new Promise(resolve=>{settle=resolve;}));
    function Harness(){const value=useGuestSources();useEffect(()=>{sources=value;},[value]);return <GuestSyncControls/>;}
    const view=mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(sources?.ready).toBe(true));
    const before=read.mock.calls.length;let pending!:ReturnType<ReturnType<typeof useGuestSources>["connectCanvas"]>;
    await act(async()=>{pending=action==="setup"?sources.connectCanvas({value:"cancelled-private",remember:false}):sources.restoreSecret("c",{value:"cancelled-private",remember:false});});
    await act(async()=>{if(cancellation==="pagehide")window.dispatchEvent(new Event("pagehide"));else sources.cancelVerification();});
    const epoch=sources.draftEpoch;expect(epoch).toBeGreaterThan(0);
    await act(async()=>settle({status:"failed",code:"GUEST_SESSION_REQUIRED",connectionId:null}));
    expect(sources.verificationRequired).toBe(false);expect(screen.queryByRole("region",{name:"Guest verification"})).not.toBeInTheDocument();expect(sources.actionOutcome).toBeNull();expect(sources.draftEpoch).toBe(epoch);
    expect(await pending).toEqual({status:"failed",code:"GUEST_INTERRUPTED",connectionId:null});
    await act(async()=>{await sources.verify("fixture-guest-"+crypto.randomUUID());});
    expect(mocks.bootstrap).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(before+1);view.unmount();
});
it("retains accepted store data after cancellation without publishing a successful action or retry",async()=>{
  let sources!:ReturnType<typeof useGuestSources>,snapshot:GuestSnapshot|null=null,settle!:(value:unknown)=>void;
  mocks.connectCanvas.mockReturnValueOnce(new Promise(resolve=>{settle=resolve;}));
  function Harness(){const value=useGuestSources(),guest=useGuest();useEffect(()=>{sources=value;if(guest.phase==="ready")snapshot=guest.snapshot;},[value,guest]);return <GuestSyncControls/>;}
  const fake=mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(sources?.ready).toBe(true));
  let pending!:ReturnType<ReturnType<typeof useGuestSources>["connectCanvas"]>;await act(async()=>{pending=sources.connectCanvas({value:"accepted-private",remember:false});});
  await act(async()=>window.dispatchEvent(new Event("pagehide")));
  const accepted={...guestSnapshot(),revision:1,connections:[{id:"accepted",kind:"canvas" as const,enabled:true,generation:1,createdAt:"",updatedAt:""}]};
  await act(async()=>{fake.replace(accepted);settle({status:"success",code:null,connectionId:"accepted"});});
  expect(snapshot!.connections).toEqual(accepted.connections);expect(await pending).toEqual({status:"failed",code:"GUEST_INTERRUPTED",connectionId:null});expect(sources.actionOutcome).toBeNull();expect(sources.verificationRequired).toBe(false);
});
it("bootstraps only after fresh proof and deliberate continue, then retries rejected setup with the coordinator",async()=>{
  mocks.connectCanvas.mockResolvedValueOnce({status:"failed",code:"GUEST_SESSION_REQUIRED",connectionId:null}).mockResolvedValueOnce({status:"success",code:null,connectionId:"c"});mocks.bootstrap.mockResolvedValue({ok:true});
  function Harness(){const s=useGuestSources();return <><button onClick={()=>{void s.connectCanvas({value:"private",remember:false});}}>setup</button><button onClick={()=>{void s.verify("fixture-proof");}}>proof and continue</button>{s.verificationRequired&&<p>needs verification</p>}</>;}
  mount(guestSnapshot(),<Harness/>);await userEvent.click(await screen.findByText("setup"));await screen.findByText("needs verification");expect(mocks.bootstrap).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("proof and continue"));await waitFor(()=>expect(mocks.connectCanvas).toHaveBeenCalledTimes(2));
  expect(mocks.bootstrap).toHaveBeenCalledWith(expect.objectContaining({schemaVersion:1,turnstileToken:"fixture-proof",requestId:expect.any(String)}),expect.any(AbortSignal));expect(mocks.refresh).not.toHaveBeenCalled();
});
it("does not retry an uncertain failure or replay a mixed run after proof",async()=>{
  mocks.connectCanvas.mockRejectedValueOnce(new GuestDataError("SERVICE_UNAVAILABLE"));
  mocks.run.mockResolvedValue(report([outcome("canvas-feed",{status:"failed",code:"GUEST_SESSION_REQUIRED"}),outcome("canvas-status")]));mocks.bootstrap.mockResolvedValue({ok:true});
  function Harness(){const s=useGuestSources();return <><button onClick={()=>{void s.connectCanvas({value:"private",remember:false});}}>setup</button><button onClick={()=>{void s.run();}}>run</button><button onClick={()=>{void s.verify("proof");}}>verify</button></>;}
  mount(guestSnapshot(),<Harness/>);await userEvent.click(await screen.findByText("setup"));expect(mocks.connectCanvas).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByText("run"));await userEvent.click(screen.getByText("verify"));expect(mocks.run).toHaveBeenCalledOnce();expect(mocks.connectCanvas).toHaveBeenCalledOnce();
});
it("keeps a safely rejected setup available for a new proof after challenge failure",async()=>{
  mocks.connectCanvas.mockResolvedValueOnce({status:"failed",code:"GUEST_SESSION_REQUIRED",connectionId:null}).mockResolvedValueOnce({status:"success",code:null,connectionId:"c"});
  mocks.bootstrap.mockRejectedValueOnce(new GuestDataError("GUEST_CHALLENGE_FAILED")).mockResolvedValueOnce({ok:true});
  function Harness(){const s=useGuestSources();return <><button disabled={!s.ready||s.busy} onClick={()=>{void s.connectCanvas({value:"private",remember:false});}}>setup</button><button onClick={()=>{void s.verify("fixture-guest-"+crypto.randomUUID());}}>verify</button></>;}
  mount(guestSnapshot(),<Harness/>);await waitFor(()=>expect(screen.getByText("setup")).toBeEnabled());await userEvent.click(screen.getByText("setup"));await userEvent.click(screen.getByText("verify"));await userEvent.click(screen.getByText("verify"));
  expect(mocks.bootstrap).toHaveBeenCalledTimes(2);expect(mocks.connectCanvas).toHaveBeenCalledTimes(2);
});
