/**
 * Cloudflare Pages — Advanced Mode worker.
 *
 * WHY THIS FILE EXISTS
 * Pages only compiles the `functions/` directory during a Git-connected build
 * or a `wrangler pages deploy`. A dashboard drag-and-drop ("Direct Upload")
 * deployment uploads `functions/` as ordinary static files and never runs them.
 * A root-level `_worker.js`, by contrast, IS executed on direct-upload projects.
 * So the login-log endpoint lives here instead.
 *
 * REQUIRES a KV namespace bound to this Pages project with the variable name
 * "LOGIN_LOG" (Settings > Functions > KV namespace bindings). Without it the
 * endpoint returns 500 and the dashboard shows "Couldn't load the login log" —
 * sign-in itself still works, it just isn't recorded.
 *
 * Storage shape: one JSON object under the KV key "users", keyed by lowercased
 * email: { "jane@medwestrealty.com": { name, email, lastAt } }. Each sign-in
 * overwrites that person's entry — ONE row per person, not a full history.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function handleGet(env) {
  try {
    if (!env.LOGIN_LOG) throw new Error('LOGIN_LOG KV binding is missing');
    const raw = await env.LOGIN_LOG.get('users');
    const data = raw ? JSON.parse(raw) : {};
    const list = Object.values(data).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return new Response(JSON.stringify(list), { headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to read login log', detail: String(err && err.message || err) }),
      { status: 500, headers: JSON_HEADERS });
  }
}

async function handlePost(request, env) {
  try {
    if (!env.LOGIN_LOG) throw new Error('LOGIN_LOG KV binding is missing');
    const body = await request.json();
    const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
    const name = (body && body.name ? String(body.name) : '').trim();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers: JSON_HEADERS });
    }
    const raw = await env.LOGIN_LOG.get('users');
    const data = raw ? JSON.parse(raw) : {};
    data[email] = { name: name || email, email, lastAt: new Date().toISOString() };
    await env.LOGIN_LOG.put('users', JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to record login', detail: String(err && err.message || err) }),
      { status: 500, headers: JSON_HEADERS });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/loginlog') {
      if (request.method === 'GET')  return handleGet(env);
      if (request.method === 'POST') return handlePost(request, env);
      return new Response(JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...JSON_HEADERS, Allow: 'GET, POST' } });
    }

    // Everything else is a static asset. env.ASSETS applies _headers and
    // _redirects, so those files keep working exactly as before.
    return env.ASSETS.fetch(request);
  },
};
