import {canvasFixtureResponse} from "@/lib/sources/canvas-ical/e2e-fixture-fetch";
import {getE2EFixtureRuntime} from '@/lib/testing/e2e-runtime';
export async function GET(request:Request){if(!await getE2EFixtureRuntime(request))return new Response("Not found",{status:404});return canvasFixtureResponse();}
