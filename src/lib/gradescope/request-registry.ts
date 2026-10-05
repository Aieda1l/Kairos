import "server-only";

const REQUEST_TTL_MS=10*60*1000;

export type GradescopeRequestKind="discovery"|"sync";

export type RegisteredGradescopeRequest={
  requestId:string;
  kind:GradescopeRequestKind;
  connectionId:string|null;
  courseIds:string[];
  startedAt:string;
  expiresAt:number;
};

export type GradescopeRequestRegistration=Omit<RegisteredGradescopeRequest,"expiresAt">;

export class GradescopeRequestRegistry{
  private entries=new Map<string,RegisteredGradescopeRequest>();

  register(input:GradescopeRequestRegistration):void{
    this.entries.set(input.requestId,{
      ...input,
      courseIds:[...input.courseIds],
      expiresAt:Date.parse(input.startedAt)+REQUEST_TTL_MS,
    });
  }

  consume(requestId:string,nowMs=Date.now()):RegisteredGradescopeRequest|null{
    const entry=this.entries.get(requestId);
    if(!entry)return null;
    this.entries.delete(requestId);
    if(!Number.isFinite(entry.expiresAt)||nowMs>entry.expiresAt)return null;
    return {...entry,courseIds:[...entry.courseIds]};
  }

  clear():void{
    this.entries.clear();
  }
}

const registry=new GradescopeRequestRegistry();

export function registerGradescopeRequest(input:GradescopeRequestRegistration):void{
  registry.register(input);
}

export function consumeGradescopeRequest(requestId:string,nowMs?:number):RegisteredGradescopeRequest|null{
  return registry.consume(requestId,nowMs);
}

export function resetGradescopeRequestRegistryForTests():void{
  registry.clear();
}
