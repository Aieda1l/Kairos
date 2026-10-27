"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {openGuestStore} from "@/lib/guest/store";
import type {GuestPreferences,GuestSnapshot,GuestStore} from "@/lib/guest/types";

type Identity=Pick<GuestSnapshot,"datasetId"|"revision">;
type State={phase:"loading"}|{phase:"error";identity:Identity|null}|{phase:"ready";snapshot:GuestSnapshot};
type GuestContextValue=State & {
  actionError:string|null;
  savePreferences:(patch:Partial<GuestPreferences>)=>Promise<boolean>;
};
type Pending={datasetId:string;patch:Partial<GuestPreferences>};
type Session={store:GuestStore;active:boolean;identity:Identity|null;snapshot:GuestSnapshot|null;pending:Pending[];writes:Promise<unknown>;readVersion:number;readFailed:boolean};
const GuestContext=createContext<GuestContextValue|null>(null);
/** Internal ownership port: consumers may use the acquired store, but never close it. */
type GuestStoreLifecycle={store:GuestStore;datasetId:string;isActive:()=>boolean;onRetire:(listener:()=>void)=>()=>void};
const GuestStoreContext=createContext<GuestStoreLifecycle|null>(null);
export function useGuestStoreLifecycle(){return useContext(GuestStoreContext);}
const sameIdentity=(a:Identity|null,b:Identity)=>a?.datasetId===b.datasetId&&a.revision===b.revision;

export function GuestProvider({children,storeFactory=openGuestStore}:{children:ReactNode;storeFactory?:()=>Promise<GuestStore>}) {
  const [state,setState]=useState<State>({phase:"loading"});
  const [actionError,setActionError]=useState<string|null>(null);
  const session=useRef<Session|null>(null);
  const [lifecycle,setLifecycle]=useState<GuestStoreLifecycle|null>(null);

  function publish(current:Session){
    if(!current.active||!current.snapshot||current.readFailed)return;
    let preferences=current.snapshot.preferences;
    for(const item of current.pending)if(item.datasetId===current.snapshot.datasetId)preferences={...preferences,...item.patch};
    setState({phase:"ready",snapshot:{...current.snapshot,preferences}});
  }

  useEffect(()=>{
    let disposed=false;
    let owned:Session|null=null;
    let unsubscribe:(()=>void)|undefined;
    let currentLifecycle:GuestStoreLifecycle|null=null;
    let retire=()=>{};
    function acquireLifecycle(store:GuestStore,datasetId:string){
      if(currentLifecycle?.datasetId===datasetId)return;
      retire();
      let active=true;const listeners=new Set<()=>void>();
      currentLifecycle={store,datasetId,isActive:()=>active,onRetire:listener=>{if(!active)listener();else listeners.add(listener);return ()=>{listeners.delete(listener);};}};
      retire=()=>{active=false;for(const listener of listeners)listener();listeners.clear();};
      setLifecycle(currentLifecycle);
    }
    void (async()=>{
      try{
        const store=await storeFactory();
        if(disposed){store.close();return;}
        setState({phase:"loading"});
        setActionError(null);
        const current:Session={store,active:true,identity:null,snapshot:null,pending:[],writes:Promise.resolve(),readVersion:0,readFailed:false};
        owned=current;session.current=current;
        async function refresh(initial=false){
          const version=++current.readVersion;
          try{
            const identity=await store.getIdentity();
            if(!current.active||version!==current.readVersion)return;
            if(!initial&&!current.readFailed&&sameIdentity(current.snapshot,identity))return;
            current.identity=identity;
            const snapshot=await store.read();
            if(!current.active||version!==current.readVersion)return;
            current.snapshot=snapshot;
            current.identity={datasetId:snapshot.datasetId,revision:snapshot.revision};
            current.readFailed=false;
            acquireLifecycle(store,snapshot.datasetId);
            publish(current);
          }catch{
            if(current.active&&version===current.readVersion){current.readFailed=true;setState({phase:"error",identity:current.identity});}
          }
        }
        unsubscribe=store.subscribe(()=>{void refresh();});
        await refresh(true);
      }catch{
        if(!disposed)setState({phase:"error",identity:null});
      }
    })();
    return ()=>{
      disposed=true;
      retire();
      if(owned){owned.active=false;unsubscribe?.();owned.store.close();if(session.current===owned)session.current=null;}
    };
  },[storeFactory]);

  function savePreferences(patch:Partial<GuestPreferences>):Promise<boolean>{
    const current=session.current;
    if(!current?.active||!current.snapshot)return Promise.resolve(false);
    const pending:Pending={datasetId:current.snapshot.datasetId,patch:structuredClone(patch)};
    current.pending.push(pending);setActionError(null);publish(current);
    const write=current.writes.then(async()=>{
      if(!current.active)return false;
      try{
        const saved=await current.store.savePreferences(pending.patch,pending.datasetId);
        // A read/notification may already have observed a newer revision or dataset.
        if(current.active&&current.identity?.datasetId===saved.datasetId&&saved.revision>=current.identity.revision){
          current.readVersion++;current.readFailed=false;
          current.identity={datasetId:saved.datasetId,revision:saved.revision};current.snapshot=saved;
        }
        return true;
      }catch{
        if(current.active)setActionError("Your change could not be saved in this browser. Check browser storage and try again.");
        return false;
      }finally{
        current.pending=current.pending.filter(item=>item!==pending);
        publish(current);
      }
    });
    current.writes=write;
    return write;
  }

  return <GuestStoreContext.Provider value={lifecycle}><GuestContext.Provider value={{...state,actionError,savePreferences}}>{children}</GuestContext.Provider></GuestStoreContext.Provider>;
}

export function useGuest():GuestContextValue {
  const value=useContext(GuestContext);
  if(!value)throw Error("GuestProvider is required.");
  return value;
}
