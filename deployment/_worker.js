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


// ─── Shared Pipeline Deals storage ──────────────────────────────────────
// Stored in the same KV namespace as the login log (or a "PIPELINE" binding
// if one is added later) under the key "pipeline":
// { version, updatedAt, updatedBy, pipeline:[...deals], notes:[...lease notes] }
// Every save sends the version it started from; if someone else saved in
// between, the save is refused (409) and the page reloads the latest list.
function pipelineKV(env){ return env.PIPELINE || env.LOGIN_LOG; }

async function handlePipelineGet(env){
  try {
    const kv = pipelineKV(env);
    if (!kv) throw new Error('No KV binding for pipeline');
    const raw = await kv.get('pipeline');
    return new Response(raw || '{}', { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to read pipeline', detail: String(err && err.message || err) }),
      { status: 500, headers: JSON_HEADERS });
  }
}

async function handlePipelinePut(request, env){
  try {
    const kv = pipelineKV(env);
    if (!kv) throw new Error('No KV binding for pipeline');
    const text = await request.text();
    if (text.length > 2000000) return new Response(JSON.stringify({ error: 'Too large' }), { status: 413, headers: JSON_HEADERS });
    const body = JSON.parse(text);
    if (!body || !Array.isArray(body.pipeline) || !Array.isArray(body.notes)) {
      return new Response(JSON.stringify({ error: 'pipeline and notes must be lists' }), { status: 400, headers: JSON_HEADERS });
    }
    const raw = await kv.get('pipeline');
    const cur = raw ? JSON.parse(raw) : {};
    const curVersion = cur.version || 0;
    if ((body.baseVersion || 0) !== curVersion) {
      return new Response(JSON.stringify({ error: 'conflict', version: curVersion }), { status: 409, headers: JSON_HEADERS });
    }
    const next = {
      version: curVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: String(body.by || '').slice(0, 120),
      pipeline: body.pipeline,
      notes: body.notes,
    };
    await kv.put('pipeline', JSON.stringify(next));
    return new Response(JSON.stringify({ ok: true, version: next.version, updatedAt: next.updatedAt }), { headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save pipeline', detail: String(err && err.message || err) }),
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

    if (url.pathname === '/api/pipeline') {
      if (request.method === 'GET') return handlePipelineGet(env);
      if (request.method === 'PUT') return handlePipelinePut(request, env);
      return new Response(JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...JSON_HEADERS, Allow: 'GET, PUT' } });
    }

    // Everything else is a static asset. env.ASSETS applies _headers and
    // _redirects, so those files keep working exactly as before.
    return env.ASSETS.fetch(request);
  },
};
