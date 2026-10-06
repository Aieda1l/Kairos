export type UserScope={
  userId:string;
};

type SessionLike={
  user?:{
    id?:string | null;
  } | null;
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
  const {auth}=await import("../../../auth");
  return auth();
}

export async function requireUserScope(
  getSession:SessionGetter=getCurrentSession,
):Promise<UserScope>{
  const session=await getSession();
  const userId=session?.user?.id?.trim();

  if(!userId){
    throw new AuthenticationRequiredError();
  }

  return {userId};
}
