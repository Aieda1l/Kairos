const APPLICATION_ORIGIN="https://mykairos.me";
const CONTROL_CHARACTERS=/[\u0000-\u001f\u007f]/;

function decodedVariants(value:string):string[]|null{
  const variants=[value];
  let current=value;
  try{
    for(let count=0;count<2;count++){
      const decoded=decodeURIComponent(current);
      if(decoded===current)break;
      variants.push(decoded);
      current=decoded;
    }
  }catch{
    return null;
  }
  return variants;
}

function normalizeReturnTo(value:string):string|null{
  if(value.length===0 || value.trim()!==value)return null;

  const variants=decodedVariants(value);
  if(!variants)return null;
  for(const variant of variants){
    if(
      !variant.startsWith("/")
      || variant.startsWith("//")
      || variant.includes("\\")
      || CONTROL_CHARACTERS.test(variant)
    )return null;
  }

  let url:URL;
  try{
    url=new URL(value,APPLICATION_ORIGIN);
  }catch{
    return null;
  }
  if(url.origin!==APPLICATION_ORIGIN)return null;

  const normalized=`${url.pathname}${url.search}${url.hash}`;
  if(
    !normalized.startsWith("/")
    || normalized.startsWith("//")
    || normalized.includes("\\")
    || CONTROL_CHARACTERS.test(normalized)
  )return null;
  return normalized;
}

export function isSafeReturnTo(input:string):boolean{
  return normalizeReturnTo(input)!==null;
}

export function safeReturnTo(
  input:string|null,
  fallback="/upcoming",
):string{
  if(input!==null){
    const normalized=normalizeReturnTo(input);
    if(normalized)return normalized;
  }
  return normalizeReturnTo(fallback)??"/upcoming";
}
