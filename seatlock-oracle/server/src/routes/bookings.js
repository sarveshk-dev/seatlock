import { Router } from 'express';
import { exec, withTransaction, inList, UTC_NOW, iso } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, HttpError } from '../http.js';
import { notifySeatsChanged } from '../realtime.js';

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await exec(
    `SELECT b.id, b.seat_labels, b.total_amount, b.status, b.payment_ref,
            s.id AS show_id, ${iso('s.starts_at')} AS starts_iso, s.screen_name, m.title, m.accent_color,
            CASE WHEN s.starts_at > ${UTC_NOW} THEN 1 ELSE 0 END AS upcoming
       FROM bookings b
       JOIN shows s ON s.id = b.show_id
       JOIN movies m ON m.id = s.movie_id
      WHERE b.user_id = :userId
      ORDER BY b.created_at DESC, b.id DESC`, { userId: req.user.id });
  res.json(rows.map((r) => ({
    id: r.id, seat_labels: r.seat_labels, total_amount: Number(r.total_amount), status: r.status,
    payment_ref: r.payment_ref, show_id: r.show_id, starts_at: r.starts_iso, screen_name: r.screen_name,
    title: r.title, accent_color: r.accent_color.trim(), upcoming: r.upcoming === 1,
  })));
}));

router.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const bookingId = Number(req.params.id);
  let showId;

  await withTransaction(async (tx) => {
    // "FOR UPDATE OF b.status" locks only the booking row, not the joined show row.
    const { rows } = await tx.exec(
      `SELECT b.id, b.status, b.show_id,
              CASE WHEN s.starts_at > ${UTC_NOW} THEN 1 ELSE 0 END AS upcoming
         FROM bookings b JOIN shows s ON s.id = b.show_id
        WHERE b.id = :bookingId AND b.user_id = :userId
          FOR UPDATE OF b.status WAIT 10`, { bookingId, userId: req.user.id });
    const booking = rows[0];
    if (!booking) throw new HttpError(404, 'Booking not found');
    if (booking.status !== 'confirmed') throw new HttpError(409, 'This booking is already cancelled');
    if (!booking.upcoming) throw new HttpError(400, 'Past shows cannot be cancelled');
    showId = booking.show_id;

    const { rows: links } = await tx.exec('SELECT show_seat_id FROM booking_seats WHERE booking_id = :bookingId', { bookingId });
    const seatIds = links.map((l) => l.show_seat_id).sort((a, b) => a - b);
    const l = inList('s', seatIds);

    await tx.exec(`SELECT id FROM show_seats WHERE id IN (${l.sql}) ORDER BY id FOR UPDATE WAIT 10`, l.binds);
    await tx.exec(
      `UPDATE show_seats SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE id IN (${l.sql})`, l.binds);
    await tx.exec('DELETE FROM booking_seats WHERE booking_id = :bookingId', { bookingId });
    await tx.exec(`UPDATE bookings SET status = 'cancelled' WHERE id = :bookingId`, { bookingId });
  });

  notifySeatsChanged(showId);
  res.json({ cancelled: true });
}));

export default router;
