import './prelude.mjs';
import application from './app/server/index.js';
const ingress = /* GUEST_HOSTED_INGRESS */null;
const candidate = {
  fetch(request, bindings, context) {
    const url = new URL(request.url);
    if (!ingress || url.protocol !== 'https:' || url.hostname !== ingress.hostname || url.port || url.username || url.password || url.search || url.hash || !ingress.routes.some(route => route.method === request.method && route.path === url.pathname)) return new Response('GUEST_INGRESS_DENIED', {
      status: 404
    });
    const secret = bindings.GUEST_OPERATOR_SECRET;
    if (typeof secret !== 'string' || !secret || request.headers.get('x-guest-operator') !== secret) return new Response('GUEST_OPERATOR_DENIED', {
      status: 403
    });
    if (!application || typeof application.fetch !== 'function') return new Response('GUEST_APPLICATION_UNSUPPORTED', {
      status: 503
    });
    return application.fetch.call(application, request, bindings, context);
  }
};
export default candidate;
