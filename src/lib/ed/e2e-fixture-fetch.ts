import "server-only";

const E2E_TOKEN=["fixture","ed","token","never","echo"].join("-");

function json(body:unknown,status=200):Response{
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json","cache-control":"no-store"},
  });
}

const fixtureFetch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.toString():input.url);
  if(url.origin!=="https://us.edstem.org"||!url.pathname.startsWith("/api/")){
    return json({error:"not found"},404);
  }
  if((init?.method??"GET").toUpperCase()!=="GET"){
    return json({error:"method not allowed"},405);
  }
  const authHeaderName=["author","ization"].join("");
  const authValue=new Headers(init?.headers).get(authHeaderName);
  if(authValue!==["Bearer",E2E_TOKEN].join(" ")){
    return json({error:"unauthorized"},401);
  }

  if(url.pathname==="/api/user"){
    return json({
      user:{id:7},
      courses:[{
        course:{id:123,code:"CSE 331",name:"Software Design",year:"2026",session:"Autumn"},
        role:{role:"student"},
      }],
    });
  }

  if(url.pathname==="/api/courses/123/lessons"){
    return json({
      modules:[],
      lessons:[
        {
          id:10,course_id:123,title:"Ed Dated Lesson",status:"unattempted",state:"active",
          is_hidden:false,is_unlisted:false,effective_due_at:"2026-10-12T06:59:00.000Z",
          effective_available_at:"2026-10-01T17:00:00.000Z",
        },
        {
          id:11,course_id:123,title:"Ed Undated Lesson",status:"attempted",state:"active",
          is_hidden:false,is_unlisted:false,due_at:null,effective_available_at:"2026-10-02T17:00:00.000Z",
        },
        {
          id:12,course_id:123,title:"Ed Completed Lesson",status:"completed",state:"active",
          is_hidden:false,is_unlisted:false,effective_due_at:"2026-10-13T06:59:00.000Z",
          effective_available_at:"2026-10-03T17:00:00.000Z",
        },
      ],
    });
  }

  return json({error:"not found"},404);
};

export function getEdRouteFetch():typeof fetch{
  return process.env.E2E_FIXTURES==="1"?fixtureFetch:fetch;
}
