import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatMoney, formatShowTime } from '../format.js';

export default function Movies() {
  const [movies, setMovies] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/movies').then(setMovies).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="notice error">{error}</p>;
  if (!movies) return <p className="muted">Loading films…</p>;

  return (
    <section className="page">
      <h1 className="page-title">Now showing</h1>
      <p className="lede">Pick a showtime. Seats you select are reserved for you while you pay, and everyone else sees them update live.</p>
      <ul className="movie-list">
        {movies.map((m) => (
          <li key={m.id} className="movie" style={{ '--accent': m.accent_color }}>
            <div className="movie-info">
              <h2>{m.title}</h2>
              <p className="facts">{m.language}, {m.duration_min} min</p>
              <p className="synopsis">{m.synopsis}</p>
            </div>
            <div className="showtimes">
              {m.shows.length === 0 && <span className="muted">No upcoming shows</span>}
              {m.shows.map((s) =>
                s.seats_left > 0 ? (
                  <Link key={s.id} to={`/shows/${s.id}`} className="showtime">
                    <strong>{formatShowTime(s.starts_at)}</strong>
                    <span>{s.screen_name}</span>
                    <span>{formatMoney(s.price)}</span>
                    <span className={s.seats_left < 15 ? 'low' : ''}>{s.seats_left} seats left</span>
                  </Link>
                ) : (
                  <span key={s.id} className="showtime soldout">
                    <strong>{formatShowTime(s.starts_at)}</strong>
                    <span>Sold out</span>
                  </span>
                )
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
