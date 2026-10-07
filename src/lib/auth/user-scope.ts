export type UserScope={
  userId:string;
};

type SessionLike={
  user?:object | null;
} | null;

type SessionGetter=()=>Promise<SessionLike>;

export class AuthenticationRequiredError extends Error{
  readonly code="AUTH_REQUIRED";

  constructor(){
    super("Authentication required.");
    this.name="AuthenticationRequiredError";
  }
}

async function getE2EFixtureUserId():Promise<string|null>{
  if(process.env.E2E_FIXTURES==="1"){
    return process.env.KAIROS_E2E_USER_ID?.trim()||"kairos-e2e-user";
  }

  try{
    const {env}=await import("cloudflare:workers");
    if(env.E2E_FIXTURES==="1"){
      const configured=typeof env.KAIROS_E2E_USER_ID==="string"
        ?env.KAIROS_E2E_USER_ID.trim()
        :"";
      return configured||"kairos-e2e-user";
    }
  }catch{
    // Non-Workers compatibility and unit-test environments have no binding module.
  }
  return null;
}

async function getCurrentSession():Promise<SessionLike>{
  const fixtureUserId=await getE2EFixtureUserId();
  if(fixtureUserId)return {user:{id:fixtureUserId}};

  const {auth}=await import("../../../auth");
  return auth();
}

function sessionUserId(session:SessionLike):string | null{
  const user=session?.user;
  if(!user || !("id" in user)){
    return null;
  }

  const id=(user as {id?:unknown}).id;
  return typeof id==="string" && id.trim().length>0 ? id.trim() : null;
}

export async function requireUserScope(
  getSession:SessionGetter=getCurrentSession,
):Promise<UserScope>{
  const userId=sessionUserId(await getSession());

  if(!userId){
    throw new AuthenticationRequiredError();
  }

  return {userId};
}
