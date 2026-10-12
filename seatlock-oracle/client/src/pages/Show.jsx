import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { formatClock, formatMoney, formatShowTime } from '../format.js';
import SeatMap from '../components/SeatMap.jsx';

export default function Show() {
  const { id } = useParams();
  const showId = Number(id);
  const nav = useNavigate();

  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'error' | 'info', text }
  const [deadline, setDeadline] = useState(null);
  const [now, setNow] = useState(Date.now());
  const refreshTimer = useRef();
  const hadHold = useRef(false);
  const booked = useRef(false);

  const load = useCallback(async () => {
    const d = await api(`/shows/${showId}`);
    setData(d);
    const t = Date.now();
    setNow(t); // keep the clock in sync with the new deadline, or the first render shows extra seconds
    setDeadline(d.mySecondsLeft != null ? t + d.mySecondsLeft * 1000 : null);
    return d;
  }, [showId]);

  // Initial load + live updates pushed by the server whenever any seat changes.
  useEffect(() => {
    load().catch((e) => setNotice({ kind: 'error', text: e.message }));
    const socket = getSocket();
    const join = () => socket.emit('join', showId);
    join();
    socket.on('connect', join); // re-join after a reconnect
    const onChange = (msg) => {
      if (msg.showId !== showId) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => load().catch(() => {}), 80);
    };
    socket.on('seats:changed', onChange);
    return () => {
      clearTimeout(refreshTimer.current);
      socket.off('connect', join);
      socket.off('seats:changed', onChange);
      socket.emit('leave', showId);
    };
  }, [showId, load]);

  const mine = data ? data.seats.filter((s) => s.state === 'mine') : [];
  hadHold.current = mine.length > 0;

  // Give seats back immediately if the user walks away without paying.
  useEffect(() => () => {
    if (hadHold.current && !booked.current) {
      api(`/shows/${showId}/hold`, { method: 'PUT', body: { seatIds: [] }, keepalive: true }).catch(() => {});
    }
  }, [showId]);

  // Countdown, driven by the server's "seconds left" so clock skew never matters.
  useEffect(() => {
    if (!deadline) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);

  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  useEffect(() => {
    if (deadline && secondsLeft === 0) {
      setNotice({ kind: 'info', text: 'Your reservation timed out and the seats were released. Pick them again to continue.' });
      load().catch(() => {});
    }
  }, [deadline, secondsLeft, load]);

  async function toggle(seat) {
    if (busy) return;
    const current = mine.map((s) => s.id);
    const next = seat.state === 'mine' ? current.filter((x) => x !== seat.id) : [...current, seat.id];
    if (next.length > data.maxSeats) {
      setNotice({ kind: 'info', text: `You can reserve up to ${data.maxSeats} seats per booking.` });
      return;
    }
    setBusy(true);
    try {
      await api(`/shows/${showId}/hold`, { method: 'PUT', body: { seatIds: next } });
      setNotice(null);
    } catch (e) {
      setNotice({
        kind: 'error',
        text: e.status === 409 ? 'Someone just reserved that seat. Please pick another.' : e.message,
      });
    } finally {
      await load().catch(() => {});
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    try {
      const booking = await api(`/shows/${showId}/book`, { method: 'POST', body: { seatIds: mine.map((s) => s.id) } });
      booked.current = true;
      nav('/bookings', { state: { justBooked: booking.id } });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
      await load().catch(() => {});
      setBusy(false);
    }
  }

  if (!data) return notice ? <p className="notice error">{notice.text}</p> : <p className="muted">Loading seats…</p>;

  const { show } = data;
  const total = show.price * mine.length;
  const urgent = secondsLeft !== null && secondsLeft <= 60;

  return (
    <section className="show-layout" style={{ '--accent': show.accent_color }}>
      <div className="show-main">
        <h1 className="page-title">{show.title}</h1>
        <p className="lede">{formatShowTime(show.starts_at)}, {show.screen_name}. Seats update live as other people choose.</p>
        {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
        <SeatMap seats={data.seats} onToggle={toggle} disabled={busy} />
      </div>

      <aside className="stub" aria-live="polite">
        <h2>Your seats</h2>
        {mine.length === 0 ? (
          <p className="muted">Select up to {data.maxSeats} seats. We hold them for {Math.round(data.holdSeconds / 60)} minutes while you pay.</p>
        ) : (
          <>
            <p className="chosen">{mine.map((s) => `${s.row}${s.number}`).join(', ')}</p>
            <dl className="totals">
              <div><dt>{mine.length} × {formatMoney(show.price)}</dt><dd>{formatMoney(total)}</dd></div>
            </dl>
            <div className={`countdown${urgent ? ' urgent' : ''}`}>
              <span>Reserved for</span>
              <strong>{formatClock(secondsLeft ?? 0)}</strong>
            </div>
            <button className="primary wide" onClick={pay} disabled={busy}>Pay {formatMoney(total)}</button>
            <button className="link" onClick={() => api(`/shows/${showId}/hold`, { method: 'PUT', body: { seatIds: [] } }).then(load)}>
              Clear selection
            </button>
            <p className="muted small">Payment is simulated in this demo.</p>
          </>
        )}
      </aside>
    </section>
  );
}
