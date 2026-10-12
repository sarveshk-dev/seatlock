import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { exec, OUT_ID } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { asyncHandler, HttpError } from '../http.js';

const router = Router();
const rounds = () => Number(process.env.BCRYPT_ROUNDS) || 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !EMAIL.test(email || '') || (password || '').length < 6) {
    throw new HttpError(400, 'Enter a name, a valid email and a password of at least 6 characters');
  }
  const hash = await bcrypt.hash(password, rounds());
  try {
    const r = await exec(
      'INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :hash) RETURNING id INTO :id',
      { name: name.trim(), email: email.toLowerCase(), hash, id: OUT_ID }
    );
    const user = { id: r.outBinds.id[0], name: name.trim() };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.errorNum === 1) throw new HttpError(409, 'An account with this email already exists'); // ORA-00001
    throw err;
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await exec('SELECT id, name, password_hash FROM users WHERE email = :email', {
    email: (email || '').toLowerCase(),
  });
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password || '', row.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const user = { id: row.id, name: row.name };
  res.json({ token: signToken(user), user });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: { id: req.user.id, name: req.user.name } }));

export default router;
