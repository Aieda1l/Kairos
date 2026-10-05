import { handleBridgeRequest, type BrowserBrokerAdapter } from "./background/broker";

async function firstTab(url:string):Promise<{id:number}|null>{
  const tabs=await browser.tabs.query({url});
  const tab=tabs.find(candidate=>typeof candidate.id==="number");
  return typeof tab?.id==="number"?{id:tab.id}:null;
}

const adapter:BrowserBrokerAdapter={
  extensionVersion:()=>browser.runtime.getManifest().version,
  findCanvasTab:()=>firstTab("https://canvas.uw.edu/*"),
  sendToCanvasTab:(tabId,request)=>browser.tabs.sendMessage(tabId,request),
  findGradescopeTab:()=>firstTab("https://www.gradescope.com/*"),
  sendToGradescopeTab:(tabId,request)=>browser.tabs.sendMessage(tabId,request),
};

browser.runtime.onMessage.addListener((message)=>handleBridgeRequest(message,adapter));
