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

async function getCurrentSession():Promise<SessionLike>{
  const [{headers},{getAuthSessionFromHeaders}]=await Promise.all([
    import("next/headers"),
    import("../../../auth"),
  ]);
  return getAuthSessionFromHeaders(new Headers(await headers())) as Promise<SessionLike>;
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
