// Keeps the free Supabase project awake. Supabase pauses free projects after a week with no
// activity; Vercel calls this once a day (see "crons" in vercel.json), and it makes two real
// requests that reach the database: a leaderboard read through the game API, and a REST call.
const SUPABASE = 'https://tnpsckkmlmmozpzkwsly.supabase.co';
const KEY = 'sb_publishable_BE4vMVSHTYs9jOMToZHcCA_VODrszGp';   // public key, safe to ship

export async function GET(request) {
  // When CRON_SECRET is set in Vercel, only Vercel's scheduler may trigger this.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  const results = {};
  try {
    const r = await fetch(`${SUPABASE}/functions/v1/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: KEY, origin: 'https://left-or-right-peach.vercel.app' },
      body: JSON.stringify({ action: 'boards', rounds: 20 }),
    });
    results.api = r.status;
  } catch (e) { results.api = 'error: ' + e.message; }
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/`, { headers: { apikey: KEY } });
    results.rest = r.status;
  } catch (e) { results.rest = 'error: ' + e.message; }
  const ok = results.api === 200;
  console.log('keepalive', JSON.stringify(results), `${Date.now() - started} ms`);
  return Response.json({ ok, ...results, at: new Date().toISOString() }, { status: ok ? 200 : 502, headers: { 'cache-control': 'no-store' } });
}
