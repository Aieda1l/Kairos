const requested=new WeakSet<StorageManager>();

/** Ask once per document's storage manager without delaying a user's saved result. */
export function requestGuestPersistence():void {
  try {
    const storage=typeof navigator!=="undefined"?navigator.storage:undefined;
    if(storage&&typeof storage.persist==="function"&&!requested.has(storage)){
      requested.add(storage);
      void storage.persist().catch(()=>{});
    }
  } catch {/* Storage persistence is optional and may be unavailable. */}
}
