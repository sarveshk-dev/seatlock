import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { formatMoney, formatShowTime } from '../format.js';

export default function Bookings() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const justBooked = useLocation().state?.justBooked;

  const load = () => api('/bookings').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function cancel(b) {
    if (!window.confirm(`Cancel ${b.title} (${b.seat_labels})? The seats go back on sale.`)) return;
    try {
      await api(`/bookings/${b.id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!rows) return error ? <p className="notice error">{error}</p> : <p className="muted">Loading tickets…</p>;

  return (
    <section className="page">
      <h1 className="page-title">My tickets</h1>
      {justBooked && <p className="notice ok" role="status">Booking confirmed. Enjoy the film!</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p className="muted">No tickets yet. <Link to="/">Find a show</Link></p>
      ) : (
        <ul className="tickets">
          {rows.map((b) => (
            <li key={b.id} className={`ticket ${b.status}${b.id === justBooked ? ' fresh' : ''}`} style={{ '--accent': b.accent_color }}>
              <div className="ticket-main">
                <h2>{b.title}</h2>
                <p>{formatShowTime(b.starts_at)}, {b.screen_name}</p>
                <p className="seats">Seats {b.seat_labels}</p>
              </div>
              <div className="ticket-side">
                <strong>{formatMoney(b.total_amount)}</strong>
                <span className="muted small">{b.payment_ref}</span>
                {b.status === 'cancelled' ? (
                  <span className="badge">Cancelled</span>
                ) : b.upcoming ? (
                  <button className="link danger" onClick={() => cancel(b)}>Cancel booking</button>
                ) : (
                  <span className="badge">Watched</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
