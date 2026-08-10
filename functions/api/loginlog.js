// Cloudflare Pages Function — serves /api/loginlog
//
// Requires a KV namespace bound to this Pages project with the variable
// name "LOGIN_LOG" (Pages project > Settings > Functions > KV namespace
// bindings). Without that binding, requests to this endpoint will fail —
// the dashboard is written to fail silently in that case (sign-in still
// works locally; the shared login log just won't populate).
//
// Storage shape: one JSON object stored under the KV key "users", keyed by
// lowercased email, e.g. { "jane@medwestrealty.com": { name, email, lastAt } }.
// Each sign-in overwrites that person's entry with their latest timestamp —
// this intentionally keeps ONE record per person, not a full history.

export async function onRequestGet(context) {
  try {
    const raw = await context.env.LOGIN_LOG.get('users');
    const data = raw ? JSON.parse(raw) : {};
    const list = Object.values(data).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return new Response(JSON.stringify(list), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to read login log' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
    const name  = (body && body.name  ? String(body.name)  : '').trim();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const raw = await context.env.LOGIN_LOG.get('users');
    const data = raw ? JSON.parse(raw) : {};
    data[email] = { name: name || email, email, lastAt: new Date().toISOString() };
    await context.env.LOGIN_LOG.put('users', JSON.stringify(data));

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to record login' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
