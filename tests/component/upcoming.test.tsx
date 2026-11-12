// @vitest-environment jsdom
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
import {AssignmentExplorer} from "@/features/assignments/assignment-explorer";
import type {Assignment} from "@/lib/assignments/types";

const {refresh,statusSyncNow}=vi.hoisted(()=>({refresh:vi.fn(),statusSyncNow:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh})}));
vi.mock("@/features/gradescope/gradescope-provider",()=>({
  useGradescope:()=>({connection:null,courses:[],phase:"idle",lastSuccessfulAt:null,message:"",syncNow:vi.fn()}),
}));
vi.mock("@/features/ed/ed-provider",()=>({
  useEd:()=>({connection:null,courses:[],phase:"idle",lastSuccessfulAt:null,message:"",syncNow:vi.fn()}),
}));
vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"0.2.0",
    canvasTabDetected:true,
    message:"",
    lastAttemptedAt:null,
    lastSuccessfulAt:"2026-10-03T20:00:00.000Z",
    lastErrorCode:null,
    updatedCount:1,
    failedCount:0,
    syncNow:statusSyncNow,
  }),
}));
vi.mock("@/features/calendars/calendar-provider",()=>({
  useCalendarSync:()=>({
    connections:[],
    phaseFor:()=> "idle",
    messageFor:()=> "",
    syncAll:vi.fn(async()=>undefined),
  }),
}));

const items:Assignment[]=[
  {id:"1",source:"canvas",externalId:"1",courseId:"1",courseName:"CSE 331",title:"Homework 3",releaseAt:null,dueAt:"2026-10-04T05:00:00Z",lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://example.com/1",sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"submitted",isLate:true,isMissing:false,submittedAt:null,checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
  {id:"2",source:"canvas",externalId:"2",courseId:"2",courseName:"MATH 308",title:"Problem Set",releaseAt:null,dueAt:null,lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:null},
];

const groupedItems:Assignment[]=[
  {...items[0],title:"Overdue homework",dueAt:"2026-10-02T19:00:00Z",submissionStatus:null},
  {...items[1],title:"Today's problem set",dueAt:"2026-10-03T22:00:00Z"},
];

beforeEach(()=>{refresh.mockClear();statusSyncNow.mockClear();vi.unstubAllGlobals();});

it("keeps hosted controls and source navigation by default when empty",()=>{
  render(<AssignmentExplorer assignments={[]} timeZone="America/Los_Angeles" canvasConnected/>);
  expect(screen.getByRole("button",{name:"Sync All"})).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"Connect a source"})).toHaveAttribute("href","/sources");
});

it("collapses sections independently and expands them with the keyboard",async()=>{
  const user=userEvent.setup();
  render(<AssignmentExplorer assignments={groupedItems} timeZone="America/Los_Angeles" now={new Date("2026-10-03T19:00:00Z")} canvasConnected/>);
  const overdue=screen.getByRole("button",{name:"Overdue 1"});
  const today=screen.getByRole("button",{name:"Today 1"});
  expect(overdue).toHaveAttribute("aria-expanded","true");
  expect(screen.getByText("Overdue homework")).toBeVisible();
  await user.click(overdue);
  expect(overdue).toHaveAttribute("aria-expanded","false");
  expect(screen.queryByText("Overdue homework")).not.toBeInTheDocument();
  expect(screen.getByText("Today's problem set")).toBeVisible();
  expect(today).toHaveAttribute("aria-expanded","true");
  expect(document.getElementById(overdue.getAttribute("aria-controls")!)).toBeInTheDocument();
  expect(overdue.getAttribute("aria-controls")).not.toBe(today.getAttribute("aria-controls"));
  await user.keyboard("{Enter}");
  expect(screen.getByText("Overdue homework")).toBeVisible();
  await user.keyboard(" ");
  expect(screen.queryByText("Overdue homework")).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Sync All"})).toBeVisible();
});

it("retains a collapsed section through refreshed data and filters while updating its count",async()=>{
  const user=userEvent.setup();
  const props={timeZone:"America/Los_Angeles",now:new Date("2026-10-03T19:00:00Z"),canvasConnected:true};
  const {rerender}=render(<AssignmentExplorer {...props} assignments={groupedItems}/>);
  await user.click(screen.getByRole("button",{name:"Overdue 1"}));
  const refreshed=[...groupedItems,{...groupedItems[0],id:"3",externalId:"3",title:"Another overdue assignment"}];
  rerender(<AssignmentExplorer {...props} assignments={refreshed}/>);
  expect(screen.getByRole("button",{name:"Overdue 2"})).toHaveAttribute("aria-expanded","false");
  expect(screen.queryByText("Another overdue assignment")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Course"),"MATH 308");
  expect(screen.queryByRole("button",{name:/Overdue/})).not.toBeInTheDocument();
  expect(screen.getByText("Today's problem set")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Course"),"");
  const overdue=screen.getByRole("button",{name:"Overdue 2"});
  expect(overdue).toHaveAttribute("aria-expanded","false");
  await user.click(overdue);
  expect(screen.getByText("Overdue homework")).toBeVisible();
  expect(screen.getByText("Another overdue assignment")).toBeVisible();
});

it("groups and filters upcoming assignments while showing submission status",async()=>{
  const user=userEvent.setup();
  render(<AssignmentExplorer assignments={items} timeZone="America/Los_Angeles" now={new Date("2026-10-03T19:00:00Z")} canvasConnected/>);
  expect(screen.queryByText("Today")).not.toBeInTheDocument();
  expect(screen.getByRole("heading",{name:/No due date/})).toBeInTheDocument();
  expect(screen.queryByText("Submitted · Late")).not.toBeInTheDocument();
  expect(screen.getByText("Status unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Sync All"})).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Course"),"CSE 331");
  expect(screen.queryByText("Homework 3")).not.toBeInTheDocument();
  expect(screen.queryByText("Problem Set")).not.toBeInTheDocument();
});

it("refreshes server-rendered assignments after a successful deadline sync",async()=>{
  const user=userEvent.setup();
  const requests=vi.fn(async(input:RequestInfo|URL)=>{
    if(String(input)==='/api/sync-all/start')return Response.json({runId:'11111111-1111-4111-8111-111111111111',expiresAt:new Date(Date.now()+600000).toISOString(),steps:['canvas-deadlines','canvas-submissions']});
    return Response.json({connectionId:"1",inserted:1,updated:0,skipped:0,errors:[],partial:false,completedAt:"2026-10-03T20:00:00Z"});
  });
  vi.stubGlobal("fetch",requests);
  render(<AssignmentExplorer assignments={items} timeZone="America/Los_Angeles" now={new Date("2026-10-03T19:00:00Z")} canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect(statusSyncNow).toHaveBeenCalledTimes(1);
  expect(requests.mock.calls[0][0]).toBe('/api/sync-all/start');
});
