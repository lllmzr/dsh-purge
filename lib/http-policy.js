// Shared policy for the plugin's HTTP bridges. Loopback describes a socket,
// never the trustworthiness of the page which caused the request.
function header(request, name) {
  const value = request?.headers?.[name];
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

export function checkPluginRequest(request) {
  const method = String(request?.method || 'GET').toUpperCase();
  const host = header(request, 'host').toLowerCase();
  const site = header(request, 'sec-fetch-site').toLowerCase();
  const origin = header(request, 'origin');
  const remote = String(request?.socket?.remoteAddress || '');
  const localSocket = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  const reject = (error = 'cross-origin request rejected', status = 403) => ({ ok: false, status, error });
  if (!host || site === 'cross-site') return reject();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      && !/^application\/json(?:\s*;|$)/i.test(header(request, 'content-type'))) {
    return reject('application/json required', 415);
  }
  if (origin && origin !== 'null') {
    let parsed;
    try { parsed = new URL(origin); } catch { return reject(); }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const protocol = request?.socket?.encrypted ? 'https:' : 'http:';
      return parsed.host.toLowerCase() === host && parsed.protocol === protocol
        ? { ok: true } : reject();
    }
    // Native desktop schemes have no web same-origin. Accept only native
    // loopback traffic; browser cross-site/sandboxed requests are rejected.
    if (!['app:', 'file:'].includes(parsed.protocol)) return reject();
    return localSocket && localHost && (!site || site === 'none') ? { ok: true } : reject();
  }
  if (origin === 'null') {
    return localSocket && localHost && (!site || site === 'none') ? { ok: true } : reject();
  }
  if (site === 'same-origin') return { ok: true };
  return localSocket && localHost && (!site || site === 'none') ? { ok: true } : reject();
}

export function allowPluginRequest(request, response) {
  const result = checkPluginRequest(request);
  if (result.ok) return true;
  response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ ok: false, error: result.error }));
  return false;
}

export const READ_ONLY_RULE_OPS = new Set(['status', 'scan-cwd', 'scan', 'read']);
