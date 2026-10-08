import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../util/AuthContext';
import { api } from '../util/api';

export default function RegisterPage() {
  const { register, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm]   = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('details');
  const [otp, setOtp] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      return setError('Passwords do not match');
    }
    if (form.password.length < 8) {
      return setError('Password must be at least 8 characters');
    }
    setLoading(true);
    try {
      const data = await register(form.email, form.password, form.name);
      setVerifiedEmail(data.email || form.email);
      setStep('verify');
      setMessage('We sent a 6-digit verification code to your email.');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code from your email.');
    setLoading(true);
    try {
      const data = await api.verifyRegistration(otp);
      setUser(data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/overview');
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.resendRegistrationCode();
      setMessage('A new code was sent. It expires in 10 minutes.');
    } catch (err) {
      setError(err.message || 'Unable to resend the code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/icon.png?v=1" alt="SimplerFinance" className="auth-brand-icon" />
        <h1 className="auth-title">SimplerFinance</h1>
        <p className="auth-subtitle auth-register-subtitle">
          {step === 'details' ? 'Create your account' : `Verify ${verifiedEmail}`}
        </p>

        {error && (
          <div className="auth-alert error compact">
            {error}
          </div>
        )}

        {message && (
          <div className="auth-alert success compact">
            {message}
          </div>
        )}

        {step === 'details' ? <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="form-input"
              placeholder="Your name"
              maxLength={50}
              required
              autoFocus
            />
            <small className="form-character-count">{form.name.length}/50</small>
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="form-input"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              className="form-input"
              placeholder="Min 8 characters"
              maxLength={72}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              type="password"
              value={form.confirm}
              onChange={e => setForm({ ...form, confirm: e.target.value })}
              className="form-input"
              placeholder="••••••••"
              maxLength={72}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-primary auth-primary-button"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form> : <form onSubmit={handleVerify}>
          <div className="form-group">
            <label className="form-label">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="form-input auth-code-input"
              placeholder="000000"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary auth-primary-button" disabled={loading}>
            {loading ? 'Verifying...' : 'Verify and activate account'}
          </button>
          <button type="button" onClick={resendCode} disabled={loading} className="auth-link-button auth-back-link emphasized">
            Send a new code
          </button>
          <button type="button" onClick={() => { setStep('details'); setOtp(''); setError(''); setMessage(''); }} disabled={loading} className="auth-link-button auth-small-back-link">
            Use a different email
          </button>
        </form>}

        <p className="auth-switch-copy compact">
          Already have an account?{' '}
          <Link to="/login" className="auth-text-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
