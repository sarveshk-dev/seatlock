import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { initDb, closeDb, exec, insertMany, OUT_ID } from '../src/db.js';

const ROWS = 'ABCDEFGH'.split('');
const SEATS_PER_ROW = 12;

const movies = [
  ['The Last Lighthouse', 'A keeper on a dying coast must decide who gets the final signal flare when three ships lose power in one night.', 128, 'English', '#F5B83D'],
  ['Monsoon Express', 'Strangers share a delayed overnight train from Chennai to Mumbai, and by sunrise none of them are who they claimed.', 142, 'Tamil', '#4FB8A6'],
  ['Paper Moons', 'Two rival set designers rebuild a silent-film studio in a single week before the bank takes it.', 111, 'Hindi', '#E36B8A'],
  ['Deep Cache', 'An intern at a data centre discovers that the servers have been quietly answering questions nobody asked.', 119, 'English', '#7F9CF5'],
];

// [movieIndex, screen, hoursFromNow, price]
const shows = [
  [0, 'Screen 1', 26, 220], [0, 'Screen 1', 50, 220],
  [1, 'Screen 2', 28, 260], [1, 'Screen 2', 52, 260], [1, 'Screen 3', 76, 180],
  [2, 'Screen 3', 30, 180], [2, 'Screen 1', 78, 200],
  [3, 'Screen 2', 32, 300], [3, 'Screen 3', 54, 300],
];

const utc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

async function main() {
  await initDb();
  // Child tables first (foreign keys). Users are kept.
  for (const t of ['booking_seats', 'bookings', 'show_seats', 'shows', 'movies']) await exec(`DELETE FROM ${t}`);

  const movieIds = [];
  for (const [title, synopsis, duration, language, color] of movies) {
    const r = await exec(
      `INSERT INTO movies (title, synopsis, duration_min, language, accent_color)
       VALUES (:title, :synopsis, :duration, :language, :color) RETURNING id INTO :id`,
      { title, synopsis, duration, language, color, id: OUT_ID });
    movieIds.push(r.outBinds.id[0]);
  }

  for (const [mi, screen, hours, price] of shows) {
    const startsAt = new Date(Date.now() + hours * 3600 * 1000);
    startsAt.setUTCMinutes(Math.round(startsAt.getUTCMinutes() / 30) * 30, 0, 0);
    const r = await exec(
      `INSERT INTO shows (movie_id, screen_name, starts_at, price)
       VALUES (:movieId, :screen, TO_DATE(:startsAt, 'YYYY-MM-DD HH24:MI:SS'), :price) RETURNING id INTO :id`,
      { movieId: movieIds[mi], screen, startsAt: utc(startsAt), price, id: OUT_ID });
    const showId = r.outBinds.id[0];
    const seatRows = ROWS.flatMap((row) => Array.from({ length: SEATS_PER_ROW }, (_, i) => [showId, row, i + 1]));
    await insertMany('INSERT INTO show_seats (show_id, row_label, seat_number) VALUES (:1, :2, :3)', seatRows);
  }

  const existing = await exec('SELECT id FROM users WHERE email = :email', { email: 'demo@example.com' });
  if (!existing.rows.length) {
    const hash = await bcrypt.hash('demo1234', 10);
    await exec('INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :hash)',
      { name: 'Demo User', email: 'demo@example.com', hash });
  }

  console.log(`Seeded ${movies.length} movies, ${shows.length} shows x ${ROWS.length * SEATS_PER_ROW} seats.`);
  console.log('Demo login: demo@example.com / demo1234');
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
