/**
 * Concurrency proof.
 *
 *   node scripts/loadtest.js [users=100] [mode=safe|naive] [showId=first show]
 *
 * N different users all try to grab the SAME seat at the SAME moment.
 *   safe  -> the real endpoint (transaction + SELECT ... FOR UPDATE)  => exactly 1 winner
 *   naive -> check-then-update with no locking                         => several "winners" (double booking)
 *
 * Requires the API running with ENABLE_DEMO=true.
 */
const BASE = process.env.BASE_URL || 'http://localhost:4000/api';
const N = Number(process.argv[2]) || 100;
const MODE = process.argv[3] || 'safe';
let SHOW_ID = Number(process.argv[4]) || 0;

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getToken(i) {
  const email = `loadtest${i}@example.com`;
  const password = 'loadtest123';
  let r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) r = await call('/auth/register', { method: 'POST', body: { name: `Load Tester ${i}`, email, password } });
  if (!r.data.token) throw new Error(`Could not authenticate user ${i}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

(async () => {
  if (!SHOW_ID) SHOW_ID = (await call('/movies')).data.flatMap((m) => m.shows)[0].id;
  console.log(`\nSeatLock load test: ${N} users, mode="${MODE}", show #${SHOW_ID}\n`);

  await call('/demo/reset', { method: 'POST', body: { showId: SHOW_ID } });
  const { data } = await call(`/shows/${SHOW_ID}`);
  const target = data.seats.find((s) => s.state === 'available');
  console.log(`Target seat: ${target.row}${target.number} (id ${target.id})`);

  process.stdout.write('Preparing users... ');
  const tokens = await inBatches([...Array(N).keys()], 10, getToken);
  console.log('ready.\nFiring all requests at once...');

  const started = performance.now();
  const results = await Promise.all(tokens.map((token) =>
    MODE === 'naive'
      ? call('/demo/naive-book', { method: 'POST', body: { seatId: target.id } })
      : call(`/shows/${SHOW_ID}/hold`, { method: 'PUT', token, body: { seatIds: [target.id] } })));
  const ms = Math.round(performance.now() - started);

  const wins = results.filter((r) => r.status === 200).length;
  const conflicts = results.filter((r) => r.status === 409).length;
  const errors = results.length - wins - conflicts;

  console.log('\n--------------- RESULT ---------------');
  console.log(`Requests sent        : ${N}`);
  console.log(`Succeeded (got seat) : ${wins}`);
  console.log(`Rejected (409)       : ${conflicts}`);
  console.log(`Other errors         : ${errors}`);
  console.log(`Total time           : ${ms} ms`);
  console.log('--------------------------------------');
  if (wins === 1) console.log('PASS: exactly one user got the seat. No double booking.\n');
  else if (wins > 1) console.log(`FAIL: ${wins} users were told they got the SAME seat. This is a double booking.\n`);
  else console.log('Nobody got the seat (check the server logs).\n');

  await call('/demo/reset', { method: 'POST', body: { showId: SHOW_ID } });
  process.exit(wins === 1 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
