import jwt from 'jsonwebtoken';
import { HttpError } from './http.js';

const secret = () => process.env.JWT_SECRET || 'dev-secret';

export const signToken = (user) => jwt.sign({ id: user.id, name: user.name }, secret(), { expiresIn: '7d' });

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(new HttpError(401, 'Please log in'));
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please log in again'));
  }
}

export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try { req.user = jwt.verify(token, secret()); } catch { /* treat as anonymous */ }
  }
  next();
}
