// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {GuestProvider} from "@/features/guest/guest-provider";
import {GuestShell} from "@/features/guest/guest-shell";
import {GuestViews} from "@/features/guest/guest-views";
import {GuestSourcesProvider} from "@/features/guest/guest-sources-provider";
import {isGuestEnabled} from "@/lib/guest/feature";
import * as guestStore from "@/lib/guest/store";
import GuestLayout from "@/app/guest/layout";
import HomePage from "@/app/page";
import {guestSnapshot,guestStoreFake} from "../helpers/guest-store-fake";

const {sessionResolver,d1Resolver,feature,hostedControls}=vi.hoisted(()=>({sessionResolver:vi.fn(()=>{throw Error("account runtime");}),d1Resolver:vi.fn(()=>{throw Error("D1 runtime");}),feature:vi.fn(async()=>true),hostedControls:vi.fn(()=>{throw Error("hosted controls");})}));
vi.mock("@/lib/guest/server/feature",()=>({getGuestEnabled:feature}));
vi.mock("@/lib/guest/server/public-config",()=>({getGuestPublicSiteKey:async()=>"public-site"}));
vi.mock("@/lib/platform/source-runtime",()=>({getSourceRuntimeContext:d1Resolver}));
vi.mock("../../../auth",()=>({auth:sessionResolver,getAuthSessionFromHeaders:sessionResolver}));
vi.mock("@/features/sync/connected-source-sync-controls",()=>({ConnectedSourceSyncControls:hostedControls}));
vi.mock("next/navigation",()=>({usePathname:()=>"/guest/upcoming",notFound:()=>{throw Error("not-found");}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it("enables only literal string true and gates guest layout and homepage CTA",async()=>{
  for(const value of [undefined,false,true,"false","1",1,"TRUE"])expect(isGuestEnabled({KAIROS_GUEST_ENABLED:value})).toBe(false);
  expect(isGuestEnabled({KAIROS_GUEST_ENABLED:"true"})).toBe(true);
  feature.mockResolvedValueOnce(false);
  const view=render(await HomePage());
  expect(screen.queryByRole("link",{name:"Try without an account"})).not.toBeInTheDocument();
  view.unmount();
  render(await HomePage());
  expect(screen.getByRole("link",{name:"Try without an account"})).toHaveAttribute("href","/guest/upcoming");
  const fake=guestStoreFake();vi.spyOn(guestStore,"openGuestStore").mockResolvedValue(fake.store);
  vi.stubGlobal("matchMedia",vi.fn((media:string)=>({matches:false,media,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn(()=>true)})));
  render(await GuestLayout({children:<GuestViews view="upcoming"/>}));
  expect(await screen.findByText("No assignments yet")).toBeVisible();
  expect(screen.getByRole("navigation",{name:"Guest navigation"})).toBeVisible();
  expect(screen.getByRole("link",{name:"Connect a source"})).toHaveAttribute("href","/guest/sources");
  expect(hostedControls).not.toHaveBeenCalled();
  expect(sessionResolver).not.toHaveBeenCalled();
  expect(d1Resolver).not.toHaveBeenCalled();
  feature.mockResolvedValueOnce(false);
  await expect(GuestLayout({children:<p>hidden</p>})).rejects.toThrow("not-found");
});

it("guest views do not enter account runtime or hosted controls for empty and populated datasets",async()=>{
  const fake=guestStoreFake();
  const view=render(<GuestProvider storeFactory={async()=>fake.store}><GuestSourcesProvider siteKey="public-site"><GuestShell><GuestViews view="upcoming"/></GuestShell></GuestSourcesProvider></GuestProvider>);
  await screen.findByText("No assignments yet");
  expect(screen.getByText("Saved in this browser")).toBeVisible();
  for(const path of ["upcoming","calendar","assignments","sources","settings"])expect(screen.getByRole("link",{name:new RegExp(`^${path}$`,"i")})).toHaveAttribute("href",`/guest/${path}`);
  expect(screen.getByRole("link",{name:"Connect a source"})).toHaveAttribute("href","/guest/sources");
  expect(screen.queryByRole("button",{name:/sign out|sync all/i})).not.toBeInTheDocument();
  view.unmount();
  const snapshot=guestSnapshot();
  snapshot.assignments=[{id:"a",externalId:"1",source:"canvas",courseId:null,courseName:"Math",title:"Homework",releaseAt:null,dueAt:null,lateDueAt:null,status:"pending",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",sourceConnectionId:"c",metadataCheckedAt:null}];
  const populated=guestStoreFake(snapshot);
  render(<GuestProvider storeFactory={async()=>populated.store}><GuestSourcesProvider siteKey="public-site"><GuestViews view="upcoming"/></GuestSourcesProvider></GuestProvider>);
  await screen.findByText("Homework");
  expect(hostedControls).not.toHaveBeenCalled();
  expect(sessionResolver).not.toHaveBeenCalled();
  expect(d1Resolver).not.toHaveBeenCalled();
});

it("shows honest browser storage recovery and local source forms",async()=>{
  const failed=render(<GuestProvider storeFactory={async()=>{throw Error("private details");}}><GuestViews view="assignments"/></GuestProvider>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/browser.*storage/i);
  expect(screen.queryByText("private details")).not.toBeInTheDocument();
  failed.unmount();
  render(<GuestProvider storeFactory={async()=>guestStoreFake().store}><GuestSourcesProvider siteKey="public-site"><GuestViews view="sources"/></GuestSourcesProvider></GuestProvider>);
  expect(await screen.findByLabelText("Canvas calendar feed URL")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Connect Ed"})).toBeInTheDocument();
});
