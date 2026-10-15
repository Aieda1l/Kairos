// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import SettingsPage from "@/app/(dashboard)/settings/page";

const {syncNow,routerPush}=vi.hoisted(()=>({syncNow:vi.fn(),routerPush:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:routerPush})}));
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

it("requires explicit confirmation before deleting the hosted account",async()=>{
  const user=userEvent.setup();
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(init?.method==="DELETE")return new Response(null,{status:204});
    return new Response(JSON.stringify({timeZone:"America/Los_Angeles"}));
  });
  vi.stubGlobal("fetch",fetchMock);
  render(<SettingsPage/>);

  expect(screen.getByRole("heading",{name:"Delete account"})).toBeInTheDocument();
  expect(screen.getByText(/Remove generated events/i)).toBeInTheDocument();
  const button=screen.getByRole("button",{name:"Delete my account"});
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText(/type DELETE/i),"DELETE");
  expect(button).toBeEnabled();
  await user.click(button);
  expect(fetchMock).toHaveBeenCalledWith("/api/account",expect.objectContaining({
    method:"DELETE",
    body:JSON.stringify({confirmation:"DELETE"}),
  }));
  expect(routerPush).toHaveBeenCalledWith("/");
});
