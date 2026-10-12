import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: form });
      login(data);
      nav(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page narrow">
      <h1 className="page-title">{mode === 'login' ? 'Log in to book' : 'Create your account'}</h1>
      <form onSubmit={submit} className="form">
        {mode === 'register' && (
          <label>Name<input value={form.name} onChange={set('name')} autoComplete="name" required /></label>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} minLength={6}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      <p className="muted">
        {mode === 'login' ? 'New here? ' : 'Already have an account? '}
        <button className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Create an account' : 'Log in'}
        </button>
      </p>
      {mode === 'login' && <p className="muted small">Demo account: demo@example.com / demo1234</p>}
    </section>
  );
}
