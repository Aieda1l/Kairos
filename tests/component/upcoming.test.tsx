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

const items:Assignment[]=[
  {id:"1",source:"canvas",externalId:"1",courseId:"1",courseName:"CSE 331",title:"Homework 3",releaseAt:null,dueAt:"2026-10-04T05:00:00Z",lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:"https://example.com/1",sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:{state:"submitted",isLate:true,isMissing:false,submittedAt:null,checkedAt:"2026-10-03T20:00:00Z",extractorVersion:"canvas-html-v1"}},
  {id:"2",source:"canvas",externalId:"2",courseId:"2",courseName:"MATH 308",title:"Problem Set",releaseAt:null,dueAt:null,lateDueAt:null,status:"unknown",sourceStatusText:null,gradeScore:null,gradeMax:null,gradeDisplay:null,sourceUrl:null,sourceUpdatedAt:null,firstSeenAt:"",lastSeenAt:"",submissionStatus:null},
];

beforeEach(()=>{refresh.mockClear();statusSyncNow.mockClear();vi.unstubAllGlobals();});

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
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({connectionId:"1",inserted:1,updated:0,skipped:0,errors:[],partial:false,completedAt:"2026-10-03T20:00:00Z"}),{status:200})));
  render(<AssignmentExplorer assignments={items} timeZone="America/Los_Angeles" now={new Date("2026-10-03T19:00:00Z")} canvasConnected/>);
  await user.click(screen.getByRole("button",{name:"Sync All"}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Canvas sync complete.")).toBeInTheDocument();
});
