/** Ask the browser to retain site storage without delaying or changing a saved result. */
export function requestGuestPersistence():void {
  try {
    if(typeof navigator!=="undefined"&&typeof navigator.storage?.persist==="function")void navigator.storage.persist().catch(()=>{});
  } catch {/* Storage persistence is optional and may be unavailable. */}
}
