// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SourceCourse } from "@/lib/sources/types";

const {discoverCourses,saveEnabledCourses,syncNow}=vi.hoisted(()=>({
  discoverCourses:vi.fn(),
  saveEnabledCourses:vi.fn(),
  syncNow:vi.fn(),
}));

const courses:SourceCourse[]=[{
  id:"local-1",
  sourceConnectionId:"connection-1",
  externalCourseId:"123",
  shortName:"CSE 331",
  fullName:"Software Design",
  term:"Autumn",
  year:"2026",
  enabled:false,
  firstSeenAt:"",
  lastSeenAt:"",
}];

vi.mock("@/features/gradescope/gradescope-provider",()=>({
  useGradescope:()=>({
    connection:{
      id:"connection-1",
      kind:"gradescope",
      label:"Gradescope",
      enabled:true,
      lastSyncStartedAt:null,
      lastSyncCompletedAt:null,
      lastSyncStatus:"never",
      lastErrorCode:null,
    },
    courses,
    phase:"idle",
    extensionDetected:true,
    extensionVersion:"0.3.0",
    gradescopeTabDetected:true,
    message:"",
    lastAttemptedAt:"2026-10-05T05:00:00.000Z",
    lastSuccessfulAt:"2026-10-05T05:00:01.000Z",
    lastErrorCode:null,
    updatedCount:0,
    failedCount:0,
    discoverCourses,
    saveEnabledCourses,
    syncNow,
  }),
}));

import { GradescopeSourceCard } from "@/features/sources/gradescope-source-card";

describe("GradescopeSourceCard",()=>{
  it("lets the user discover, choose, save, and sync Gradescope courses",async()=>{
    const user=userEvent.setup();
    render(<GradescopeSourceCard/>);

    expect(screen.getByRole("link",{name:/Open Gradescope/i})).toHaveAttribute("href","https://www.gradescope.com/");
    await user.click(screen.getByRole("button",{name:"Discover courses"}));
    expect(discoverCourses).toHaveBeenCalledTimes(1);

    const checkbox=screen.getByRole("checkbox",{name:/CSE 331/i});
    await user.click(checkbox);
    await user.click(screen.getByRole("button",{name:"Save selection"}));
    expect(saveEnabledCourses).toHaveBeenCalledWith(["123"]);

    await user.click(screen.getByRole("button",{name:"Sync Gradescope"}));
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Connected · not synced")).not.toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(screen.getByText(/Last attempted/i)).toBeVisible();
    expect(screen.getByText(/Last successful/i)).toBeVisible();
  });
});
