import { Router } from 'express';
import { exec, withTransaction, inList, OUT_ID, UTC_NOW, iso } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';
import { asyncHandler, HttpError, parseSeatIds, HOLD_SECONDS, MAX_SEATS } from '../http.js';
import { notifySeatsChanged } from '../realtime.js';

const router = Router();

/* ------------------------------------------------------------------ *
 * GET /api/shows/:id  -> show details + seat map
 * Expired holds are reported as "available" without needing a cleanup job
 * to have run yet (lazy expiry). Time comparisons use the DB clock (UTC).
 * ------------------------------------------------------------------ */
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const showId = Number(req.params.id);
  const { rows: showRows } = await exec(
    `SELECT s.id, s.screen_name, ${iso('s.starts_at')} AS starts_iso, s.price, m.title, m.accent_color
       FROM shows s JOIN movies m ON m.id = s.movie_id WHERE s.id = :showId`, { showId });
  const show = showRows[0];
  if (!show) throw new HttpError(404, 'Show not found');

  const { rows: seats } = await exec(
    `SELECT id, row_label, seat_number, held_by,
            CASE WHEN status = 'booked' THEN 'booked'
                 WHEN status = 'held' AND hold_expires_at > ${UTC_NOW} THEN 'held'
                 ELSE 'available' END AS state,
            CASE WHEN status = 'held' AND hold_expires_at > ${UTC_NOW}
                 THEN ROUND((hold_expires_at - ${UTC_NOW}) * 86400) END AS seconds_left
       FROM show_seats WHERE show_id = :showId ORDER BY row_label, seat_number`, { showId });

  const me = req.user?.id;
  const mapped = seats.map((s) => ({
    id: s.id,
    row: s.row_label,
    number: s.seat_number,
    // never leak WHO holds a seat, only whether it is "mine"
    state: s.state === 'held' && s.held_by === me ? 'mine' : s.state,
    secondsLeft: s.state === 'held' && s.held_by === me ? Number(s.seconds_left) : null,
  }));
  const mine = mapped.filter((s) => s.state === 'mine');

  res.json({
    show: {
      id: show.id, screen_name: show.screen_name, starts_at: show.starts_iso, price: Number(show.price),
      title: show.title, accent_color: show.accent_color.trim(),
    },
    seats: mapped,
    maxSeats: MAX_SEATS(),
    holdSeconds: HOLD_SECONDS(),
    mySecondsLeft: mine.length ? Math.min(...mine.map((s) => s.secondsLeft)) : null,
  });
}));

/* ------------------------------------------------------------------ *
 * PUT /api/shows/:id/hold   { seatIds: [..] }
 *
 * "Make my selection exactly this set." One atomic transaction:
 *   1. Lock the requested seats AND any seats this user already holds,
 *      in ascending id order (consistent ordering => fewer deadlocks).
 *   2. If any requested seat is booked or live-held by someone else -> 409.
 *   3. Release my old holds that are no longer selected.
 *   4. Hold the requested seats for HOLD_SECONDS (fresh timer).
 * ------------------------------------------------------------------ */
router.put('/:id/hold', requireAuth, asyncHandler(async (req, res) => {
  const showId = Number(req.params.id);
  const userId = req.user.id;
  const wanted = parseSeatIds(req.body?.seatIds, MAX_SEATS(), { allowEmpty: true });

  await withTransaction(async (tx) => {
    const ask = inList('s', wanted.length ? wanted : [0]);
    const { rows } = await tx.exec(
      `SELECT id, status, held_by,
              CASE WHEN hold_expires_at > ${UTC_NOW} THEN 1 ELSE 0 END AS hold_live
         FROM show_seats
        WHERE show_id = :showId AND (id IN (${ask.sql}) OR held_by = :userId)
        ORDER BY id
          FOR UPDATE WAIT 10`,
      { showId, userId, ...ask.binds }
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    if (wanted.some((id) => !byId.has(id))) throw new HttpError(400, 'One or more seats do not belong to this show');

    const conflicts = wanted.filter((id) => {
      const r = byId.get(id);
      return r.status === 'booked' || (r.status === 'held' && r.held_by !== userId && r.hold_live === 1);
    });
    if (conflicts.length) throw new HttpError(409, 'Some seats were just taken by someone else', { conflicts });

    const toRelease = rows
      .filter((r) => r.status === 'held' && r.held_by === userId && !wanted.includes(r.id))
      .map((r) => r.id);
    if (toRelease.length) {
      const rel = inList('r', toRelease);
      await tx.exec(
        `UPDATE show_seats SET status = 'available', held_by = NULL, hold_expires_at = NULL
          WHERE id IN (${rel.sql})`, rel.binds);
    }
    if (wanted.length) {
      const w = inList('w', wanted);
      await tx.exec(
        `UPDATE show_seats
            SET status = 'held', held_by = :userId, hold_expires_at = ${UTC_NOW} + :secs / 86400
          WHERE id IN (${w.sql})`,
        { userId, secs: HOLD_SECONDS(), ...w.binds }
      );
    }
  });

  notifySeatsChanged(showId);
  res.json({ held: wanted, expiresInSeconds: wanted.length ? HOLD_SECONDS() : null });
}));

/* ------------------------------------------------------------------ *
 * POST /api/shows/:id/book   { seatIds: [..] }
 * Turns this user's live holds into a confirmed booking (payment is mocked).
 * Fails with 409 if a hold expired or never belonged to the user.
 * ------------------------------------------------------------------ */
router.post('/:id/book', requireAuth, asyncHandler(async (req, res) => {
  const showId = Number(req.params.id);
  const userId = req.user.id;
  const ids = parseSeatIds(req.body?.seatIds, MAX_SEATS());

  const booking = await withTransaction(async (tx) => {
    const l = inList('s', ids);
    const { rows: seats } = await tx.exec(
      `SELECT id, row_label, seat_number, status, held_by,
              CASE WHEN hold_expires_at > ${UTC_NOW} THEN 1 ELSE 0 END AS hold_live
         FROM show_seats WHERE show_id = :showId AND id IN (${l.sql})
        ORDER BY id FOR UPDATE WAIT 10`,
      { showId, ...l.binds }
    );
    const allMine = seats.length === ids.length &&
      seats.every((s) => s.status === 'held' && s.held_by === userId && s.hold_live === 1);
    if (!allMine) throw new HttpError(409, 'Your hold on these seats has expired. Please select them again.');

    const { rows: showRows } = await tx.exec(
      `SELECT price, CASE WHEN starts_at > ${UTC_NOW} THEN 1 ELSE 0 END AS upcoming FROM shows WHERE id = :showId`,
      { showId });
    const show = showRows[0];
    if (!show?.upcoming) throw new HttpError(400, 'This show has already started');

    const labels = seats.map((s) => `${s.row_label}${s.seat_number}`).join(', ');
    const total = Number(show.price) * seats.length;
    const paymentRef = `PAY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    await tx.exec(
      `UPDATE show_seats SET status = 'booked', held_by = NULL, hold_expires_at = NULL WHERE id IN (${l.sql})`, l.binds);
    const ins = await tx.exec(
      `INSERT INTO bookings (user_id, show_id, seat_labels, total_amount, payment_ref)
       VALUES (:userId, :showId, :labels, :total, :ref) RETURNING id INTO :id`,
      { userId, showId, labels, total, ref: paymentRef, id: OUT_ID }
    );
    const bookingId = ins.outBinds.id[0];
    for (const seatId of ids) {
      await tx.exec('INSERT INTO booking_seats (booking_id, show_seat_id) VALUES (:bookingId, :seatId)', { bookingId, seatId });
    }
    return { id: bookingId, seats: labels, total, paymentRef };
  });

  notifySeatsChanged(showId);
  res.status(201).json(booking);
}));

export default router;
