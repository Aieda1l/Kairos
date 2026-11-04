import { env } from 'cloudflare:workers';
// Replaced only by the offline packager with the frozen version-1 operation inventory.
const protocol = /* GUEST_HOSTED_PROTOCOL */null;
const deny = () => {
  throw new Error('GUEST_TRANSPORT_DENIED');
};
export async function fixtureFetch(input, init) {
  let request;
  try {
    request = new Request(input, init);
  } catch {
    return deny();
  }
  if (!protocol || request.redirect !== 'manual') return deny();
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  if (url.username || url.password || url.hash) return deny();
  let selected;
  for (const operation of protocol.operations) {
    if (url.href !== operation.url || request.method !== operation.method) continue;
    if (operation.credentialBinding) {
      const credential = env[operation.credentialBinding];
      if (typeof credential !== 'string' || !credential || request.headers.get('authorization') !== `Bearer ${credential}`) continue;
    } else if (request.headers.has('authorization')) continue;
    if (operation.key === 'challenge') {
      if (typeof env.KAIROS_TURNSTILE_SECRET_KEY !== 'string' || !env.KAIROS_TURNSTILE_SECRET_KEY || typeof env.GUEST_FIXTURE_CHALLENGE_TOKEN !== 'string' || !env.GUEST_FIXTURE_CHALLENGE_TOKEN) return deny();
      const reader = request.clone().body?.getReader();
      if (!reader) return deny();
      let text = '',
        bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 16384) return deny();
          text += decoder.decode(next.value, {
            stream: true
          });
        }
        text += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
      }
      const form = new URLSearchParams(text);
      if (form.get('secret') !== env.KAIROS_TURNSTILE_SECRET_KEY || form.get('response') !== env.GUEST_FIXTURE_CHALLENGE_TOKEN || [...form.keys()].some(key => !['secret', 'response'].includes(key))) return deny();
    }
    selected = operation;
    break;
  }
  if (!selected || !env.GUEST_FIXTURE || typeof env.GUEST_FIXTURE.fetch !== 'function') return deny();
  // No native reference is saved, exported, retried or restored. The Request owns its body/signal.
  request.signal.throwIfAborted();
  return env.GUEST_FIXTURE.fetch(request);
}
globalThis.fetch = fixtureFetch;
