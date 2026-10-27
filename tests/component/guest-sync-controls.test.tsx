// @vitest-environment jsdom
import {StrictMode,useEffect} from "react";
import {act,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {GuestProvider} from "@/features/guest/guest-provider";
import {GuestSourcesProvider,useGuestSources} from "@/features/guest/guest-sources-provider";
import {GuestSyncControls} from "@/features/guest/guest-sync-controls";
import {GuestDataError,guestSafeMessage} from "@/lib/guest/errors";
import type {GuestStage,GuestStageOutcome} from "@/lib/guest/types";
import {guestSnapshot,guestStoreFake} from "../helpers/guest-store-fake";

const mocks=vi.hoisted(()=>({factory:vi.fn(),bootstrap:vi.fn(),clear:vi.fn(),run:vi.fn(),stop:vi.fn(),connectCanvas:vi.fn(),refresh:vi.fn()}));
vi.mock("@/lib/guest/sync/coordinator",()=>({createGuestSyncCoordinator:mocks.factory}));
vi.mock("@/lib/guest/credentials",()=>({createGuestCredentials:()=>({get:async()=>null,clear:mocks.clear})}));
vi.mock("@/lib/guest/sync/transient-client",()=>({createGuestTransientClient:()=>({bootstrap:mocks.bootstrap})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("next/script",()=>({default:()=>null}));
const outcome=(stage:GuestStage,patch:Partial<GuestStageOutcome>={}):GuestStageOutcome=>({runId:"r",stage,status:"success",code:null,updatedCount:1,failedCount:0,ignoredCount:0,pendingCount:0,attemptedAt:new Date().toISOString(),completedAt:new Date().toISOString(),...patch});
const report=(outcomes:GuestStageOutcome[])=>({run:{},mode:"manual",outcomes});
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Unexpected network");}));
  mocks.factory.mockReturnValue({run:mocks.run,stop:mocks.stop,connectCanvas:mocks.connectCanvas});mocks.run.mockResolvedValue(report([]));
  mocks.connectCanvas.mockResolvedValue({status:"success",code:null,connectionId:"c"});
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
