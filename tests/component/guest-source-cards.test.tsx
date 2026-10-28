// @vitest-environment jsdom
import {act,render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {GuestProvider,useGuestDatasetChange} from "@/features/guest/guest-provider";
import {GuestSourcesProvider} from "@/features/guest/guest-sources-provider";
import {GuestSources} from "@/features/guest/guest-sources";
import {guestSnapshot,guestStoreFake} from "../helpers/guest-store-fake";

const mocks=vi.hoisted(()=>({factory:vi.fn(),bootstrap:vi.fn(),refresh:vi.fn(),coordinator:{connectCanvas:vi.fn(),connectEd:vi.fn(),connectGradescope:vi.fn(),restoreSecret:vi.fn(),refreshCourses:vi.fn(),setEnabledCourses:vi.fn(),forgetCredential:vi.fn(),disconnect:vi.fn(),run:vi.fn(),stop:vi.fn()}}));
vi.mock("@/lib/guest/sync/coordinator",()=>({createGuestSyncCoordinator:mocks.factory}));
vi.mock("@/lib/guest/sync/transient-client",()=>({createGuestTransientClient:()=>({bootstrap:mocks.bootstrap})}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("next/script",()=>({default:()=>null}));
beforeEach(()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("Unexpected network");}));
  mocks.factory.mockReturnValue(mocks.coordinator);
  for(const action of [mocks.coordinator.connectCanvas,mocks.coordinator.connectEd,mocks.coordinator.connectGradescope,mocks.coordinator.restoreSecret,mocks.coordinator.refreshCourses,mocks.coordinator.setEnabledCourses,mocks.coordinator.forgetCredential,mocks.coordinator.disconnect])action.mockResolvedValue({status:"success",code:null,connectionId:"c"});
  mocks.coordinator.run.mockResolvedValue({run:{},mode:"manual",outcomes:[]});
});
function mount(snapshot=guestSnapshot(),extra?:React.ReactNode){
  const fake=guestStoreFake(snapshot);vi.mocked(fake.store.readRememberedSecret).mockResolvedValue(null);
  const factory=async()=>fake.store;
  const view=render(<GuestProvider storeFactory={factory}><GuestSourcesProvider siteKey="public-test"><GuestSources/>{extra}</GuestSourcesProvider></GuestProvider>);
  return {...fake,...view};
}
it("connects each source with private memory fields, explicit remembering, and no account dependency",async()=>{
  mount();
  const feed=await screen.findByLabelText("Canvas calendar feed URL");
  await waitFor(()=>expect(feed).toBeEnabled());
  await userEvent.type(feed,"https://canvas.uw.edu/feeds/calendars/private.ics");
  expect(feed).not.toHaveAttribute("value");
  await userEvent.click(screen.getByLabelText("Remember Canvas credential on this device"));
  await userEvent.click(screen.getByRole("button",{name:"Connect Canvas"}));
  expect(mocks.coordinator.connectCanvas).toHaveBeenCalledWith({value:"https://canvas.uw.edu/feeds/calendars/private.ics",remember:true});
  await waitFor(()=>expect(feed).toHaveValue(""));
  await userEvent.type(screen.getByLabelText("Ed API token"),"private-ed-token");
  await userEvent.click(screen.getByRole("button",{name:"Connect Ed"}));
  expect(mocks.coordinator.connectEd).toHaveBeenCalledWith({value:"private-ed-token",remember:false});
  await userEvent.click(screen.getByRole("button",{name:"Connect Gradescope"}));
  expect(mocks.coordinator.connectGradescope).toHaveBeenCalledOnce();
  expect(screen.getByText(/temporarily.*server/i)).toBeVisible();
  expect(screen.queryByText(/sign in to Kairos/i)).not.toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("clears unsent private drafts synchronously before a reset write, even on abort",async()=>{
  function Reset(){const change=useGuestDatasetChange();return <button onClick={()=>{void change(null,guestSnapshot().datasetId);}}>Internal reset</button>;}
  const fake=mount(guestSnapshot(),<Reset/>);const input=await screen.findByLabelText("Canvas calendar feed URL");await waitFor(()=>expect(input).toBeEnabled());await userEvent.type(input,"private-unsent-draft");
  let atWrite:string|undefined;
  fake.store.clear=vi.fn(async()=>{atWrite=(input as HTMLInputElement).value;throw Error("storage abort");});
  await userEvent.click(screen.getByText("Internal reset"));await waitFor(()=>expect(fake.store.clear).toHaveBeenCalled());expect(atWrite).toBe("");
  expect(screen.getByLabelText("Canvas calendar feed URL")).toHaveValue("");
});
it("keeps draft and course selection identities distinct after reset abort",async()=>{
  const errors=vi.spyOn(console,"error").mockImplementation(()=>{}),snapshot=guestSnapshot();snapshot.connections=[{id:"ed-local",kind:"ed",enabled:true,generation:1,createdAt:"",updatedAt:""}];
  function Reset(){const change=useGuestDatasetChange();return <button onClick={()=>{void change(null,snapshot.datasetId);}}>Internal reset</button>;}
  mount(snapshot,<Reset/>);await waitFor(()=>expect(screen.getByRole("button",{name:"Save Ed courses"})).toBeEnabled());await userEvent.click(screen.getByText("Internal reset"));await waitFor(()=>expect(screen.getByRole("button",{name:"Save Ed courses"})).toBeEnabled());
  expect(errors).not.toHaveBeenCalled();errors.mockRestore();
});
it("keeps accepted partial Canvas setup connected, clears the secret, and shows the warning",async()=>{
  mocks.coordinator.connectCanvas.mockResolvedValue({status:"success",code:"PARTIAL_SYNC",connectionId:"c"});
  mount();const input=await screen.findByLabelText("Canvas calendar feed URL");
  await waitFor(()=>expect(input).toBeEnabled());
  await userEvent.type(input,"private-partial-feed");await userEvent.click(screen.getByRole("button",{name:"Connect Canvas"}));
  expect(await screen.findByText(/some source items could not be updated/i)).toBeVisible();
  expect(input).toHaveValue("");expect(screen.queryByText("Canvas sync complete")).not.toBeInTheDocument();
});
it("retains a draft after an uncertain failure, and clears new drafts when verification is cancelled",async()=>{
  mocks.coordinator.connectCanvas.mockResolvedValueOnce({status:"failed",code:"SERVICE_UNAVAILABLE",connectionId:null}).mockResolvedValueOnce({status:"failed",code:"GUEST_SESSION_REQUIRED",connectionId:null});
  mount();const input=await screen.findByLabelText("Canvas calendar feed URL");await waitFor(()=>expect(input).toBeEnabled());
  await userEvent.type(input,"private-unsent-draft");await userEvent.click(screen.getByRole("button",{name:"Connect Canvas"}));expect(input).toHaveValue("private-unsent-draft");
  await userEvent.click(screen.getByRole("button",{name:"Connect Canvas"}));await waitFor(()=>expect(input).toHaveValue(""));
  await userEvent.type(input,"new-private-draft");await userEvent.click(screen.getByRole("button",{name:"Cancel verification"}));
  expect(screen.getByLabelText("Canvas calendar feed URL")).toHaveValue("");
});
it("preserves explicit selections and submits exact external course IDs, with separate refresh and credential actions",async()=>{
  const snapshot=guestSnapshot();snapshot.connections=[{id:"ed-local",kind:"ed",enabled:true,generation:3,createdAt:"",updatedAt:""}];
  snapshot.courses=[{id:"local-A",sourceConnectionId:"ed-local",externalCourseId:"123",shortName:"CSE 331",fullName:"Software",term:null,year:null,enabled:true,firstSeenAt:"",lastSeenAt:""},{id:"local-B",sourceConnectionId:"ed-local",externalCourseId:"456",shortName:null,fullName:"New course",term:null,year:null,enabled:false,firstSeenAt:"",lastSeenAt:""}];
  const fake=mount(snapshot);await screen.findByLabelText("CSE 331");
  expect(screen.getByLabelText("CSE 331")).toBeChecked();expect(screen.getByLabelText("New course")).not.toBeChecked();
  await userEvent.click(screen.getByLabelText("New course"));await userEvent.click(screen.getByRole("button",{name:"Save Ed courses"}));
  expect(mocks.coordinator.setEnabledCourses).toHaveBeenCalledWith("ed-local",["123","456"]);
  await userEvent.click(screen.getByRole("button",{name:"Refresh Ed courses"}));expect(mocks.coordinator.refreshCourses).toHaveBeenCalledWith("ed-local");
  await act(async()=>fake.replace({...snapshot,revision:1}));expect(screen.getByLabelText("CSE 331")).toBeChecked();
  await userEvent.type(screen.getByLabelText("Ed API token"),"replacement");await userEvent.click(screen.getByRole("button",{name:"Update Ed credential"}));
  expect(mocks.coordinator.restoreSecret).toHaveBeenCalledWith("ed-local",{value:"replacement",remember:false});
  const card=screen.getByRole("region",{name:"Ed"});await userEvent.click(within(card).getByRole("button",{name:"Disconnect Ed"}));
  expect(mocks.coordinator.disconnect).not.toHaveBeenCalled();
  await userEvent.click(within(card).getByRole("button",{name:"Confirm disconnect Ed"}));
  expect(mocks.coordinator.disconnect).toHaveBeenCalledWith("ed-local");
});
