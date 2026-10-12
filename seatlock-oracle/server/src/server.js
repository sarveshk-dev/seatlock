import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { initDb } from './db.js';
import { initRealtime } from './realtime.js';
import { startHoldExpiryJob } from './jobs/expireHolds.js';
import authRoutes from './routes/auth.js';
import movieRoutes from './routes/movies.js';
import showRoutes from './routes/shows.js';
import bookingRoutes from './routes/bookings.js';
import demoRoutes from './routes/demo.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/shows', showRoutes);
app.use('/api/bookings', bookingRoutes);
if (process.env.ENABLE_DEMO === 'true') {
  app.use('/api/demo', demoRoutes);
  console.warn('[warn] ENABLE_DEMO=true: unsafe demo endpoints are active');
}

app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

await initDb(); // fail fast with a clear message if Oracle is unreachable
console.log('Connected to Oracle');

const server = http.createServer(app);
initRealtime(server);
startHoldExpiryJob();

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => console.log(`SeatLock API listening on :${port}`));
