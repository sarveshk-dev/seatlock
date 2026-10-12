export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Express 4 does not catch rejected promises on its own.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parseSeatIds(value, max, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw new HttpError(400, 'seatIds must be an array');
  const ids = [...new Set(value.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, 'seatIds must be positive integers');
  if (!allowEmpty && ids.length === 0) throw new HttpError(400, 'Select at least one seat');
  if (ids.length > max) throw new HttpError(400, `You can book at most ${max} seats at once`);
  return ids;
}

export const HOLD_SECONDS = () => Number(process.env.HOLD_SECONDS) || 300;
export const MAX_SEATS = () => Number(process.env.MAX_SEATS_PER_BOOKING) || 6;
