// @vitest-environment jsdom
import {render,screen} from "@testing-library/react";import {expect,it} from "vitest";import {SourceStatus} from "@/features/sources/source-status";
const base={id:"1",kind:"canvas" as const,label:"Canvas",enabled:true,lastSyncStartedAt:null,lastSyncCompletedAt:"2026-10-03T20:00:00Z"};
it("shows successful sync status with text",()=>{render(<SourceStatus connection={{...base,lastSyncStatus:"success",lastErrorCode:null}}/>);expect(screen.getByText(/Connected/)).toBeInTheDocument();expect(screen.getByText(/Last successful sync/)).toBeInTheDocument();});
it("keeps partial parse warnings visible after navigation",()=>{render(<SourceStatus connection={{...base,lastSyncStatus:"success",lastErrorCode:"PARTIAL_PARSE"}}/>);expect(screen.getByText(/Synced with warnings/)).toBeInTheDocument();});

it("keeps partial sync warnings visible after navigation",()=>{render(<SourceStatus connection={{...base,lastSyncStatus:"success",lastErrorCode:"PARTIAL_SYNC"}}/>);expect(screen.getByText(/Synced with warnings/)).toBeInTheDocument();});
