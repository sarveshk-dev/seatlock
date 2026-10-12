import { exec, UTC_NOW } from '../db.js';
import { notifySeatsChanged } from '../realtime.js';

/**
 * Housekeeping: releases expired holds and pushes the change to live clients.
 * Correctness does NOT depend on this job (reads and writes already treat an
 * expired hold as free); it only keeps the table tidy and the UI instant.
 */
export function startHoldExpiryJob(intervalMs = 10_000) {
  const tick = async () => {
    try {
      const { rows: shows } = await exec(
        `SELECT DISTINCT show_id FROM show_seats WHERE status = 'held' AND hold_expires_at <= ${UTC_NOW}`);
      if (!shows.length) return;
      await exec(
        `UPDATE show_seats SET status = 'available', held_by = NULL, hold_expires_at = NULL
          WHERE status = 'held' AND hold_expires_at <= ${UTC_NOW}`);
      shows.forEach((s) => notifySeatsChanged(s.show_id));
    } catch (err) {
      console.error('[expireHolds]', err.message);
    }
  };
  return setInterval(tick, intervalMs);
}
