"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {openGuestStore} from "@/lib/guest/store";
import {requestGuestPersistence} from "@/lib/guest/persistence";
import type {GuestBackupV1,GuestPreferences,GuestSnapshot,GuestStore} from "@/lib/guest/types";

type Identity=Pick<GuestSnapshot,"datasetId"|"revision">;
type State={phase:"loading"}|{phase:"error";identity:Identity|null}|{phase:"ready";snapshot:GuestSnapshot};
type GuestContextValue=State & {
  actionError:string|null;
  savePreferences:(patch:Partial<GuestPreferences>)=>Promise<boolean>;
};
type Pending={datasetId:string;patch:Partial<GuestPreferences>};
type Session={store:GuestStore;active:boolean;identity:Identity|null;snapshot:GuestSnapshot|null;pending:Pending[];writes:Promise<unknown>;readVersion:number;readFailed:boolean;changing:boolean;epoch:number;retire:()=>void;refresh:()=>Promise<void>};
const GuestContext=createContext<GuestContextValue|null>(null);
/** Internal ownership port: consumers may use the acquired store, but never close it. */
type GuestStoreLifecycle={store:GuestStore;datasetId:string;isActive:()=>boolean;onRetire:(listener:()=>void)=>()=>void};
const GuestStoreContext=createContext<GuestStoreLifecycle|null>(null);
export function useGuestStoreLifecycle(){return useContext(GuestStoreContext);}
/** Internal guarded mutation bridge, including recovery without a readable graph. */
const DatasetContext=createContext<((backup:GuestBackupV1|null,datasetId:string)=>Promise<boolean>)|null>(null);
export function useGuestDatasetChange(){const change=useContext(DatasetContext);if(!change)throw Error("GuestProvider is required.");return change;}
const sameIdentity=(a:Identity|null,b:Identity)=>a?.datasetId===b.datasetId&&a.revision===b.revision;

export function GuestProvider({children,storeFactory=openGuestStore}:{children:ReactNode;storeFactory?:()=>Promise<GuestStore>}) {
  const [state,setState]=useState<State>({phase:"loading"});
  const [actionError,setActionError]=useState<string|null>(null);
  const session=useRef<Session|null>(null);
  const [lifecycle,setLifecycle]=useState<GuestStoreLifecycle|null>(null);

  function publish(current:Session){
    if(!current.active||!current.snapshot||current.readFailed||current.changing)return;
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
      if(currentLifecycle?.datasetId===datasetId&&currentLifecycle.isActive())return;
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
        const current:Session={store,active:true,identity:null,snapshot:null,pending:[],writes:Promise.resolve(),readVersion:0,readFailed:false,changing:false,epoch:0,
          retire:()=>{retire();currentLifecycle=null;setLifecycle(null);},refresh:()=>refresh(true)};
        owned=current;session.current=current;
        async function refresh(initial=false){
          if(current.changing)return;
          const version=++current.readVersion;
          let metadataRead=false;
          try{
            const identity=await store.getIdentity();
            if(!current.active||version!==current.readVersion)return;
            metadataRead=true;
            // Reset/import retires the lifecycle before publishing its saved snapshot.
            // A lease-only notification must still finish that pending hydration.
            if(!initial&&!current.readFailed&&currentLifecycle?.isActive()&&currentLifecycle.datasetId===identity.datasetId&&sameIdentity(current.snapshot,identity))return;
            // Identity is enough to invalidate private ownership. A replacement
            // graph may be slow or unreadable; it must never keep the old vault
            // and coordinator active while hydration is pending or failed.
            if(currentLifecycle&&currentLifecycle.datasetId!==identity.datasetId){
              retire();currentLifecycle=null;setLifecycle(null);
            }
            current.identity=identity;
            const snapshot=await store.read();
            if(!current.active||version!==current.readVersion)return;
            current.snapshot=snapshot;
            current.identity={datasetId:snapshot.datasetId,revision:snapshot.revision};
            current.readFailed=false;
            acquireLifecycle(store,snapshot.datasetId);
            publish(current);
          }catch{
            if(current.active&&version===current.readVersion){
              if(!metadataRead){current.identity=null;current.retire();}
              current.readFailed=true;setState({phase:"error",identity:current.identity});
            }
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
    if(!current?.active||!current.snapshot||current.changing)return Promise.resolve(false);
    const epoch=current.epoch;
    const pending:Pending={datasetId:current.snapshot.datasetId,patch:structuredClone(patch)};
    current.pending.push(pending);setActionError(null);publish(current);
    const write=current.writes.then(async()=>{
      if(!current.active||epoch!==current.epoch)return false;
      try{
        const saved=await current.store.savePreferences(pending.patch,pending.datasetId);
        requestGuestPersistence();
        // A read/notification may already have observed a newer revision or dataset.
        if(current.active&&epoch===current.epoch&&current.identity?.datasetId===saved.datasetId&&saved.revision>=current.identity.revision){
          current.readVersion++;current.readFailed=false;
          current.identity={datasetId:saved.datasetId,revision:saved.revision};current.snapshot=saved;
        }
        return true;
      }catch{
        if(current.active&&epoch===current.epoch)setActionError("Your change could not be saved in this browser. Check browser storage and try again.");
        return false;
      }finally{
        current.pending=current.pending.filter(item=>item!==pending);
        publish(current);
      }
    });
    current.writes=write;
    return write;
  }

  async function changeDataset(backup:GuestBackupV1|null,datasetId:string):Promise<boolean>{
    const current=session.current;
    if(!current?.active||current.changing||current.identity?.datasetId!==datasetId)return false;
    // Retire all consumers synchronously: no old requests, vault or drafts can
    // become input for the replacement. Retired handles are never reactivated.
    current.changing=true;current.epoch++;current.readVersion++;current.pending=[];
    current.retire();setActionError(null);
    let accepted=false;
    try{
      await current.writes;
      if(!current.active)return false;
      const saved=backup?await current.store.replaceDataset(backup,datasetId):await current.store.clear(datasetId);
      if(backup)requestGuestPersistence();
      if(!current.active)return false;
      current.snapshot=saved;current.identity={datasetId:saved.datasetId,revision:saved.revision};current.readFailed=false;accepted=true;
    }catch{
      if(current.active)setActionError("Local data could not be changed. Your last saved dataset was retained. Check browser storage and try again.");
    }finally{
      current.changing=false;
      if(current.active)await current.refresh();
    }
    return accepted;
  }

  return <DatasetContext.Provider value={changeDataset}><GuestStoreContext.Provider value={lifecycle}><GuestContext.Provider value={{...state,actionError,savePreferences}}>{children}</GuestContext.Provider></GuestStoreContext.Provider></DatasetContext.Provider>;
}

export function useGuest():GuestContextValue {
  const value=useContext(GuestContext);
  if(!value)throw Error("GuestProvider is required.");
  return value;
}
