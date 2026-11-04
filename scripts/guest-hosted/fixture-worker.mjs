// Private data plane only: no fetch/connect, configuration, reset or observer endpoint.
const denied = () => new Response('GUEST_FIXTURE_DENIED', {
  status: 502
});
const unavailable = () => new Response('GUEST_FIXTURE_UNAVAILABLE', {
  status: 503
});
export async function matchFixtureOperation(request, env, scenario) {
  request.signal.throwIfAborted();
  if (!scenario || scenario.version !== 1 || request.redirect !== 'manual') return null;
  const url = new URL(request.url);
  if (url.username || url.password || url.hash) return null;
  for (const operation of scenario.operations) {
    if (request.method !== operation.method || url.href !== operation.url) continue;
    if (operation.credentialBinding) {
      const credential = env[operation.credentialBinding];
      if (typeof credential !== 'string' || !credential || request.headers.get('authorization') !== `Bearer ${credential}`) continue;
    } else if (request.headers.has('authorization')) continue;
    if (operation.key === 'challenge') {
      if (typeof env.KAIROS_TURNSTILE_SECRET_KEY !== 'string' || typeof env.GUEST_FIXTURE_CHALLENGE_TOKEN !== 'string') return null;
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > 16384) return null;
      const reader = request.clone().body?.getReader();
      if (!reader) return null;
      let text = '',
        bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 16384) return null;
          text += decoder.decode(next.value, {
            stream: true
          });
        }
        text += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
      }
      const form = new URLSearchParams(text);
      if (form.get('secret') !== env.KAIROS_TURNSTILE_SECRET_KEY || form.get('response') !== env.GUEST_FIXTURE_CHALLENGE_TOKEN || [...form.keys()].some(key => !['secret', 'response'].includes(key))) return null;
    }
    return operation;
  }
  return null;
}
export async function handleFixtureRequest(request, env, scenario, bodies) {
  try {
    const operation = await matchFixtureOperation(request, env, scenario);
    if (!operation) return denied();
    if (!env.FIXTURE_DB || typeof env.FIXTURE_DB.prepare !== 'function') return unavailable();
    // One statement is the admission linearization point. No read/modify/write or isolate counters.
    const result = await env.FIXTURE_DB.prepare('UPDATE fixture_operation SET calls=calls+1 WHERE run_id=? AND scenario=? AND operation=? AND call_cap=? AND calls<call_cap RETURNING calls,call_cap').bind(scenario.runId, scenario.scenario, operation.key, operation.cap).all();
    if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) return unavailable();
    const row = result.results[0];
    if (!Number.isSafeInteger(row.calls) || row.calls < 1 || row.calls > operation.cap || row.call_cap !== operation.cap) return unavailable();
    const body = bodies[operation.body];
    if (!(body instanceof Uint8Array)) return unavailable();
    // Admission is not proof of delivered bytes; the driver must finish/schema-check responses.
    const bytes = body;
    return new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 16384) controller.enqueue(bytes.slice(offset, offset + 16384));
        controller.close();
      }
    }), {
      status: 200,
      headers: {
        'content-type': operation.contentType,
        'cache-control': 'no-store'
      }
    });
  } catch {
    return unavailable();
  }
}
