import {canvasFixtureResponse} from "@/lib/sources/canvas-ical/e2e-fixture-fetch";
export async function GET(){if(process.env.E2E_FIXTURES!=="1")return new Response("Not found",{status:404});return canvasFixtureResponse();}
