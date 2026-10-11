export type FirefoxDistribution = {
  state:"pending"|"available";
  installUrl:string|null;
  minimumVersion:140;
};

export function getFirefoxDistribution(config:{listingUrl?:string}):FirefoxDistribution{
  const pending:FirefoxDistribution={state:"pending",installUrl:null,minimumVersion:140};
  const value=config.listingUrl;
  if(!value||/[\u0000-\u0020\u007f\\]/.test(value))return pending;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.hostname!=="addons.mozilla.org"||url.port||
      url.username||url.password||url.search||url.hash)return pending;
    // A configured AMO add-on listing, optionally localized; never synthesize a slug.
    if(!/^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*\/)?firefox\/addon\/[a-z0-9][a-z0-9-]*\/?$/i.test(url.pathname))return pending;
    return {state:"available",installUrl:url.href,minimumVersion:140};
  }catch{
    return pending;
  }
}
