import { Router } from 'express';
import { exec, UTC_NOW, iso } from '../db.js';
import { asyncHandler } from '../http.js';

const router = Router();

// Movies with their upcoming shows and how many seats are still free.
router.get('/', asyncHandler(async (_req, res) => {
  const { rows: movies } = await exec(
    'SELECT id, title, synopsis, duration_min, language, accent_color FROM movies ORDER BY id');
  const { rows: shows } = await exec(
    `SELECT s.id, s.movie_id, s.screen_name, ${iso('s.starts_at')} AS starts_iso, s.price,
            SUM(CASE WHEN ss.status = 'available'
                       OR (ss.status = 'held' AND ss.hold_expires_at <= ${UTC_NOW})
                     THEN 1 ELSE 0 END) AS seats_left
       FROM shows s
       JOIN show_seats ss ON ss.show_id = s.id
      WHERE s.starts_at > ${UTC_NOW}
      GROUP BY s.id, s.movie_id, s.screen_name, s.starts_at, s.price
      ORDER BY s.starts_at`);
  res.json(movies.map((m) => ({
    ...m,
    accent_color: m.accent_color.trim(),
    shows: shows
      .filter((s) => s.movie_id === m.id)
      .map((s) => ({
        id: s.id, movie_id: s.movie_id, screen_name: s.screen_name,
        starts_at: s.starts_iso, price: Number(s.price), seats_left: Number(s.seats_left),
      })),
  })));
}));

export default router;
