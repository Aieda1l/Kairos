// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceConnection } from "@/lib/assignments/types";
import type { SourceCourse } from "@/lib/sources/types";

const {
  testToken,connect,refreshCourses,saveEnabledCourses,syncNow,state,connection,connectedCourses,emptyCourses,
}=vi.hoisted(()=>{
  const connection:SourceConnection={
    id:"ed-connection",kind:"ed",label:"Ed",enabled:true,
    lastSyncStartedAt:null,lastSyncCompletedAt:null,lastSyncStatus:"never",lastErrorCode:null,
  };
  const course:SourceCourse={
    id:"local-123",sourceConnectionId:"ed-connection",externalCourseId:"123",shortName:"CSE 331",
    fullName:"Software Design",term:"Autumn",year:"2026",enabled:false,firstSeenAt:"",lastSeenAt:"",
  };
  return {
    testToken:vi.fn(async()=>true),
    connect:vi.fn(async()=>true),
    refreshCourses:vi.fn(),
    saveEnabledCourses:vi.fn(),
    syncNow:vi.fn(),
    state:{connected:false},
    connection,
    connectedCourses:[course],
    emptyCourses:[] as SourceCourse[],
  };
});

vi.mock("@/features/ed/ed-provider",()=>({
  useEd:()=>({
    connection:state.connected?connection:null,
    courses:state.connected?connectedCourses:emptyCourses,
    phase:"idle",
    message:"",
    lastAttemptedAt:null,
    lastSuccessfulAt:null,
    lastErrorCode:null,
    testToken,connect,refreshCourses,saveEnabledCourses,syncNow,
  }),
}));

import { EdSourceCard } from "@/features/sources/ed-source-card";

beforeEach(()=>{
  state.connected=false;
  connectedCourses[0]!.enabled=false;
  for(const fn of [testToken,connect,refreshCourses,saveEnabledCourses,syncNow])fn.mockReset();
  testToken.mockResolvedValue(true);
  connect.mockResolvedValue(true);
  refreshCourses.mockResolvedValue(undefined);
  saveEnabledCourses.mockImplementation(async(ids:string[])=>{
    connectedCourses[0]!.enabled=ids.includes("123");
  });
  syncNow.mockResolvedValue(undefined);
});

describe("EdSourceCard",()=>{
  it("tests and connects with a password-style token field and clears it after save",async()=>{
    const user=userEvent.setup();
    const view=render(<EdSourceCard/>);
    const input=screen.getByLabelText("Ed API token") as HTMLInputElement;
    expect(input.type).toBe("password");
    await user.type(input,"fixture-ed-token-never-echo");
    await user.click(screen.getByRole("button",{name:"Test connection"}));
    expect(testToken).toHaveBeenCalledWith("fixture-ed-token-never-echo");
    await user.click(screen.getByRole("button",{name:"Connect Ed"}));
    expect(connect).toHaveBeenCalledWith("fixture-ed-token-never-echo");
    expect(input.value).toBe("");

    state.connected=true;
    view.rerender(<EdSourceCard/>);
    expect(screen.queryByDisplayValue("fixture-ed-token-never-echo")).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeVisible();
  });

  it("manages connected courses without exposing the saved token",async()=>{
    state.connected=true;
    const user=userEvent.setup();
    render(<EdSourceCard/>);

    expect(screen.getByRole("button",{name:"Refresh courses"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Sync Ed"})).toBeVisible();
    expect(screen.getByRole("button",{name:"Update token"})).toBeVisible();

    const checkbox=screen.getByRole("checkbox",{name:/CSE 331/i});
    await user.click(checkbox);
    await user.click(screen.getByRole("button",{name:"Save selection"}));
    expect(saveEnabledCourses).toHaveBeenCalledWith(["123"]);

    await user.click(screen.getByRole("button",{name:"Refresh courses"}));
    await user.click(screen.getByRole("button",{name:"Sync Ed"}));
    expect(refreshCourses).toHaveBeenCalledTimes(1);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("fixture-ed-token-never-echo");
  });
});
