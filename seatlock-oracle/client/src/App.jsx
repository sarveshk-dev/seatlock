import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Movies from './pages/Movies.jsx';
import Login from './pages/Login.jsx';
import Show from './pages/Show.jsx';
import Bookings from './pages/Bookings.jsx';

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

export default function App() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">SeatLock</Link>
        <nav>
          <NavLink to="/" end>Now showing</NavLink>
          {user && <NavLink to="/bookings">My tickets</NavLink>}
        </nav>
        <div className="who">
          {user ? (
            <>
              <span>{user.name}</span>
              <button className="link" onClick={logout}>Log out</button>
            </>
          ) : (
            <Link to="/login">Log in</Link>
          )}
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Movies />} />
          <Route path="/login" element={<Login />} />
          <Route path="/shows/:id" element={<RequireAuth><Show /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
