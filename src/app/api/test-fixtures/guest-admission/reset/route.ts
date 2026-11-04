import {resetLocalGuestAdmission} from "@/lib/testing/guest-fixtures";
export async function POST(request:Request){
  const deletedCount=await resetLocalGuestAdmission(request);
  const headers={"cache-control":"no-store"};
  return deletedCount===null?new Response("Not found",{status:404,headers}):Response.json({ok:true,deletedCount},{headers});
}
