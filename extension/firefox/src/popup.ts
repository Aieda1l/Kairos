async function render():Promise<void>{
  const version=document.getElementById("extension-version");
  const status=document.getElementById("canvas-status");
  if(version)version.textContent=`Version ${browser.runtime.getManifest().version}`;
  const tabs=await browser.tabs.query({url:"https://canvas.uw.edu/*"});
  if(status)status.textContent=tabs.some(tab=>typeof tab.id==="number")
    ?"Canvas tab detected"
    :"Canvas tab not detected";
}

void render();
