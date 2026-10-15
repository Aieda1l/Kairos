export function navigateDocument(path:string){
  // Connecting Canvas changes server-owned layout state, so this transition must reload it.
  window.location.assign(path);
}
