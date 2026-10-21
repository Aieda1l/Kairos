declare module "cloudflare:workers" {
  export const env:Record<string,unknown>;
  export function waitUntil(task:Promise<unknown>):void;
}
