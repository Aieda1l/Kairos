// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import SettingsPage from "@/app/(dashboard)/settings/page";

const {syncNow}=vi.hoisted(()=>({syncNow:vi.fn()}));
vi.mock("@/features/submission-status/submission-status-provider",()=>({
  useSubmissionStatusSync:()=>({
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"0.2.0",
    canvasTabDetected:true,
    message:"",
    lastAttemptedAt:"2026-10-04T06:00:00.000Z",
    lastSuccessfulAt:"2026-10-04T06:00:01.000Z",
    lastErrorCode:null,
    updatedCount:4,
    failedCount:0,
    syncNow,
  }),
}));

it("offers timezone persistence and Canvas submission-status diagnostics",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({timeZone:"America/Los_Angeles"}))));
  render(<SettingsPage/>);
  expect(screen.getByLabelText("Display timezone")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Save timezone"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"Submission status"})).toBeInTheDocument();
  expect(screen.getByText("Automatic refresh")).toBeInTheDocument();
  expect(screen.getByText("On")).toBeInTheDocument();
  expect(screen.getByText("Refresh when older than")).toBeInTheDocument();
  expect(screen.getByText("15 minutes")).toBeInTheDocument();
  expect(screen.getByText("Last successful refresh")).toBeInTheDocument();
  expect(screen.getByText("Firefox extension")).toBeInTheDocument();
  expect(screen.getByText("Connected")).toBeInTheDocument();
});
