import { handleBridgeRequest, type BrowserBrokerAdapter } from "./background/broker";

const adapter:BrowserBrokerAdapter={
  extensionVersion:()=>browser.runtime.getManifest().version,
  findCanvasTab:async()=>{
    const tabs=await browser.tabs.query({url:"https://canvas.uw.edu/*"});
    const tab=tabs.find(candidate=>typeof candidate.id==="number");
    return typeof tab?.id==="number"?{id:tab.id}:null;
  },
  sendToCanvasTab:(tabId,request)=>browser.tabs.sendMessage(tabId,request),
};

browser.runtime.onMessage.addListener((message)=>handleBridgeRequest(message,adapter));
