/**
 * End-to-end checks against a running API (ENABLE_DEMO=true) and its database.
 *   node scripts/integration.js [showId=first show]
 */
import 'dotenv/config';
import { initDb, closeDb, exec, UTC_NOW } from '../src/db.js';

const BASE = process.env.BASE_URL || 'http://localhost:4000/api';
let SHOW = Number(process.argv[2]) || 0;
let failures = 0;

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failures++; };

async function user(i) {
  const email = `itest${i}@example.com`, password = 'itest123';
  let r = await call('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) r = await call('/auth/register', { method: 'POST', body: { name: `Tester ${i}`, email, password } });
  return r.data.token;
}

(async () => {
  await initDb();
  if (!SHOW) SHOW = (await call('/movies')).data.flatMap((m) => m.shows)[0].id;
  await call('/demo/reset', { method: 'POST', body: { showId: SHOW } });
  const [a, b] = await Promise.all([user(1), user(2)]);
  const { data } = await call(`/shows/${SHOW}`, { token: a });
  const [s1, s2, s3, s4] = data.seats.slice(0, 4).map((s) => s.id);

  // 1. hold + visibility
  let r = await call(`/shows/${SHOW}/hold`, { method: 'PUT', token: a, body: { seatIds: [s1, s2] } });
  check('A holds two seats', r.status === 200);
  let mapB = (await call(`/shows/${SHOW}`, { token: b })).data.seats;
  check('B sees A\'s seats as "held" (not "mine")', mapB.find((s) => s.id === s1).state === 'held');
  let mapA = (await call(`/shows/${SHOW}`, { token: a })).data;
  check('A sees own seats as "mine" with a timer', mapA.seats.find((s) => s.id === s1).state === 'mine' && mapA.mySecondsLeft > 290);

  // 2. conflict is atomic: B asks for s2 (taken) + s3 (free) -> nothing is held
  r = await call(`/shows/${SHOW}/hold`, { method: 'PUT', token: b, body: { seatIds: [s2, s3] } });
  check('B is rejected with 409 and conflict list', r.status === 409 && r.data.conflicts?.includes(s2));
  mapB = (await call(`/shows/${SHOW}`, { token: b })).data.seats;
  check('Rejected request is all-or-nothing (s3 still free)', mapB.find((s) => s.id === s3).state === 'available');

  // 3. selection replaces earlier holds
  r = await call(`/shows/${SHOW}/hold`, { method: 'PUT', token: a, body: { seatIds: [s1] } });
  mapB = (await call(`/shows/${SHOW}`, { token: b })).data.seats;
  check('Deselecting releases the seat for others', r.status === 200 && mapB.find((s) => s.id === s2).state === 'available');

  // 4. cannot book what you do not hold
  r = await call(`/shows/${SHOW}/book`, { method: 'POST', token: b, body: { seatIds: [s1] } });
  check('B cannot book A\'s held seat', r.status === 409);

  // 5. expiry (simulated by rewinding the DB clock value) frees the seat, and A can no longer book it
  await exec(`UPDATE show_seats SET hold_expires_at = ${UTC_NOW} - 1 / 86400 WHERE id = :id`, { id: s1 });
  r = await call(`/shows/${SHOW}/book`, { method: 'POST', token: a, body: { seatIds: [s1] } });
  check('A cannot book after the hold expired', r.status === 409);
  r = await call(`/shows/${SHOW}/hold`, { method: 'PUT', token: b, body: { seatIds: [s1] } });
  check('B can take a seat whose hold expired (lazy expiry)', r.status === 200);

  // 6. happy path: book, then seat shows as booked to everyone
  r = await call(`/shows/${SHOW}/book`, { method: 'POST', token: b, body: { seatIds: [s1] } });
  check('B books the seat', r.status === 201 && r.data.total > 0, JSON.stringify(r.data));
  const bookingId = r.data.id;
  mapA = (await call(`/shows/${SHOW}`, { token: a })).data.seats;
  check('Seat now "booked" for others', mapA.find((s) => s.id === s1).state === 'booked');
  r = await call(`/shows/${SHOW}/hold`, { method: 'PUT', token: a, body: { seatIds: [s1] } });
  check('Booked seat cannot be held', r.status === 409);

  // 7. cancel frees the seat, only owner can cancel
  r = await call(`/bookings/${bookingId}/cancel`, { method: 'POST', token: a });
  check('Non-owner cannot cancel', r.status === 404);
  r = await call(`/bookings/${bookingId}/cancel`, { method: 'POST', token: b });
  check('Owner cancels booking', r.status === 200);
  mapA = (await call(`/shows/${SHOW}`, { token: a })).data.seats;
  check('Cancelled seat is available again', mapA.find((s) => s.id === s1).state === 'available');
  r = await call(`/bookings/${bookingId}/cancel`, { method: 'POST', token: b });
  check('Double cancel is rejected', r.status === 409);

  // 8. deadlock stress: 60 users each grab 2 of 4 seats, in random order
  await call('/demo/reset', { method: 'POST', body: { showId: SHOW } });
  const pool4 = [s1, s2, s3, s4];
  const tokens = await Promise.all([...Array(60).keys()].map((i) => user(100 + i)));
  const asks = tokens.map(() => pool4.slice().sort(() => Math.random() - 0.5).slice(0, 2));
  const res = await Promise.all(tokens.map((t, i) => call(`/shows/${SHOW}/hold`, { method: 'PUT', token: t, body: { seatIds: asks[i] } })));
  const winners = asks.filter((_, i) => res[i].status === 200).flat();
  check('No 5xx / deadlock errors under overlapping multi-seat requests', res.every((x) => x.status === 200 || x.status === 409),
        JSON.stringify(res.filter((x) => ![200, 409].includes(x.status))[0]));
  check('No seat granted to two users', new Set(winners).size === winners.length, `winners=${winners}`);
  const held = (await exec(`SELECT COUNT(*) AS held FROM show_seats WHERE show_id = :showId AND status = 'held'`, { showId: SHOW })).rows[0].held;
  check('DB state matches responses', held === winners.length, `db=${held} api=${winners.length}`);

  await call('/demo/reset', { method: 'POST', body: { showId: SHOW } });
  await closeDb();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
