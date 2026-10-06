// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import {render,screen} from "@testing-library/react";
import {describe,expect,it} from "vitest";
import Loading from "@/app/(dashboard)/loading";
import ErrorBoundary from "@/app/(dashboard)/error";

it("renders a safe loading state",()=>{
  render(<Loading/>);
  expect(screen.getByLabelText("Loading assignments")).toBeInTheDocument();
});

it("renders an actionable safe error",()=>{
  render(<ErrorBoundary error={new Error("secret raw exception")} reset={()=>{}}/>);
  expect(screen.getByRole("button",{name:"Retry"})).toBeInTheDocument();
  expect(screen.queryByText(/secret raw/)).not.toBeInTheDocument();
});

describe("hosted dashboard data boundary",()=>{
  it("does not load dashboard pages through the legacy SQLite runtime",()=>{
    const files=[
      "src/app/(dashboard)/layout.tsx",
      "src/app/(dashboard)/upcoming/page.tsx",
      "src/app/(dashboard)/calendar/page.tsx",
      "src/app/(dashboard)/assignments/page.tsx",
      "src/app/(dashboard)/sources/page.tsx",
    ];

    for(const relative of files){
      const source=fs.readFileSync(path.join(process.cwd(),relative),"utf8");
      expect(source,relative).not.toContain("@/lib/db/client");
      expect(source,relative).not.toContain("@/lib/db/migrate");
      expect(source,relative).not.toContain("@/lib/db/repositories/");
    }
  });
});
