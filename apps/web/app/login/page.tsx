'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import logo from '../../assets/logo.png';
import { BrandLoader } from '../components/BrandLoader';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3333';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEDIA' | 'CLIENT';
};

type LoginResponse = {
  token: string;
  user: AuthUser;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [redirectTo, setRedirectTo] = useState('/control');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    setRedirectTo(from && from.startsWith('/') ? from : '/control');

    const raw = localStorage.getItem('mediapulse-auth');
    if (raw) router.replace(from && from.startsWith('/') ? from : '/control');
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message;
        throw new Error(Array.isArray(message) ? message.join(', ') : message || 'No se pudo iniciar sesion');
      }

      localStorage.setItem('mediapulse-auth', JSON.stringify(payload as LoginResponse));
      router.replace(redirectTo);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      {loading ? <BrandLoader label="Iniciando sesión" /> : null}
      <section className="login-hero">
      </section>
      <section className="login-panel">
        <form className="login-page-form" onSubmit={handleSubmit}>
          <div className="login-heading">
            <img className="login-logo" src={logo.src} alt="MediaPulse RHD" width={1200} height={1200} />
            <h1>Bienvenido</h1>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {errorMessage ? <div className="login-error">{errorMessage}</div> : null}
          <button className="login-button" type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  );
}
