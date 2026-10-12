import { Router } from 'express';
import { exec } from '../db.js';
import { asyncHandler, HttpError } from '../http.js';
import { notifySeatsChanged } from '../realtime.js';

/**
 * DEMO ONLY (ENABLE_DEMO=true).
 *
 * /naive-book is the classic check-then-act bug, kept on purpose so the load
 * test can show what goes wrong WITHOUT transactions and row locks:
 *     1. SELECT the seat      -> "available"
 *     2. (some work happens)  -> other requests also read "available"
 *     3. UPDATE the seat      -> everyone "wins"
 */
const router = Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

router.post('/naive-book', asyncHandler(async (req, res) => {
  const seatId = Number(req.body?.seatId);
  const { rows } = await exec('SELECT status FROM show_seats WHERE id = :seatId', { seatId });
  if (!rows[0]) throw new HttpError(404, 'Seat not found');
  if (rows[0].status !== 'available') throw new HttpError(409, 'Seat already taken');
  await sleep(15); // pricing, validation, payment call... any real-world delay widens the race window
  await exec(`UPDATE show_seats SET status = 'booked' WHERE id = :seatId`, { seatId });
  res.json({ ok: true });
}));

router.post('/reset', asyncHandler(async (req, res) => {
  const showId = Number(req.body?.showId);
  await exec('DELETE FROM booking_seats WHERE booking_id IN (SELECT id FROM bookings WHERE show_id = :showId)', { showId });
  await exec('DELETE FROM bookings WHERE show_id = :showId', { showId });
  await exec(
    `UPDATE show_seats SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE show_id = :showId`, { showId });
  notifySeatsChanged(showId);
  res.json({ reset: true });
}));

export default router;
