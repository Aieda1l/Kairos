import {z} from "zod";
import {getE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

const SESSION_COOKIE="authjs.session-token";
const users={
  alice:{id:"alice",name:"Alice",email:"alice@example.invalid"},
  bob:{id:"bob",name:"Bob",email:"bob@example.invalid"},
} as const;
const schema=z.object({user:z.enum(["alice","bob"])}).strict();

function cookieValue(request:Request,name:string):string|null{
  const header=request.headers.get("cookie");
  if(!header)return null;
  for(const entry of header.split(";")){
    const [key,...rest]=entry.trim().split("=");
    if(key===name)return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function POST(request:Request){
  const runtime=await getE2EFixtureRuntime();
  if(!runtime)return new Response("Not found",{status:404});

  let body:unknown;
  try{body=await request.json();}catch{body=null;}
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json({message:"Invalid fixture user."},{status:400});
  }

  const user=users[parsed.data.user];
  await runtime.db.prepare(`
    INSERT INTO users(id,name,email) VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email
  `).bind(user.id,user.name,user.email).run();
  await runtime.db.prepare("DELETE FROM sessions WHERE userId=?")
    .bind(user.id)
    .run();

  const sessionToken=crypto.randomUUID();
  const expires=new Date(Date.now()+60*60*1000).toISOString();
  await runtime.db.prepare(
    "INSERT INTO sessions(id,sessionToken,userId,expires) VALUES (?,?,?,?)",
  ).bind(crypto.randomUUID(),sessionToken,user.id,expires).run();

  return Response.json(
    {ok:true,user:{id:user.id,name:user.name,email:user.email}},
    {
      headers:{
        "set-cookie":`${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
        "cache-control":"no-store",
      },
    },
  );
}

export async function DELETE(request:Request){
  const runtime=await getE2EFixtureRuntime();
  if(!runtime)return new Response("Not found",{status:404});

  const sessionToken=cookieValue(request,SESSION_COOKIE);
  if(sessionToken){
    await runtime.db.prepare("DELETE FROM sessions WHERE sessionToken=?")
      .bind(sessionToken)
      .run();
  }
  return Response.json(
    {ok:true},
    {
      headers:{
        "set-cookie":`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        "cache-control":"no-store",
      },
    },
  );
}
