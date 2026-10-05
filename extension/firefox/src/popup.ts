async function render():Promise<void>{
  const version=document.getElementById("extension-version");
  const canvasStatus=document.getElementById("canvas-status");
  const gradescopeStatus=document.getElementById("gradescope-status");
  if(version)version.textContent=`Version ${browser.runtime.getManifest().version}`;

  const [canvasTabs,gradescopeTabs]=await Promise.all([
    browser.tabs.query({url:"https://canvas.uw.edu/*"}),
    browser.tabs.query({url:"https://www.gradescope.com/*"}),
  ]);

  if(canvasStatus)canvasStatus.textContent=canvasTabs.some(tab=>typeof tab.id==="number")
    ?"Canvas tab detected"
    :"Canvas tab not detected";
  if(gradescopeStatus)gradescopeStatus.textContent=gradescopeTabs.some(tab=>typeof tab.id==="number")
    ?"Gradescope tab detected"
    :"Gradescope tab not detected";
}

void render();
