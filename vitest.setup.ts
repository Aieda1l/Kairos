import "@testing-library/jest-dom/vitest";
import {vi} from "vitest";
import {getDatabase,migrate} from "./tests/helpers/legacy-db";

vi.mock("@/lib/platform/source-api-runtime",async importOriginal=>{
  const actual=await importOriginal<typeof import("@/lib/platform/source-api-runtime")>();

  async function legacyRuntime(){
    const db=getDatabase();
    migrate(db);
    return {kind:"legacy" as const,db};
  }

  async function getSourceRouteRuntime(){
    if(process.env.KAIROS_TEST_LEGACY_SOURCE_RUNTIME==="1"){
      return legacyRuntime();
    }
    return actual.getSourceRouteRuntime();
  }

  async function resolveSourceApiRuntime(){
    if(process.env.KAIROS_TEST_LEGACY_SOURCE_RUNTIME==="1"){
      return {ok:true as const,runtime:await legacyRuntime()};
    }
    return actual.resolveSourceApiRuntime();
  }

  return {...actual,getSourceRouteRuntime,resolveSourceApiRuntime};
});
