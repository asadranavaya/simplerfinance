import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../util/AuthContext';
import { api } from '../util/api';

export default function LoginPage() {
  const { setUser } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm]       = useState({ email: '', password: '' });
  const [error, setError]     = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  // OTP state variables
  const [step, setStep]           = useState('password'); // 'password' | 'otp'
  const [otp, setOtp]             = useState('');
  const [otpError, setOtpError]   = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLocked(false);
    setLoading(true);
    try {
      const data = await api.login(form.email, form.password);

      // Check if MFA is required
      if (data.mfaRequired) {
        setStep('otp');
      } else {
        setUser(data.user);
        navigate(data.user.role === 'admin' ? '/admin' : '/overview');
      }
    } catch (err) {
      const { locked, attemptsRemaining } = err.data || {};

      if (locked) {
        setIsLocked(true);
        setError(err.message); // "Too many failed attempts. Try again in X minutes."
      } else if (attemptsRemaining !== null && attemptsRemaining !== undefined && attemptsRemaining <= 3) {
        setError(`Invalid email or password — ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before your account is temporarily blocked.`);
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setOtpError('');
    setResendMsg('');
    setOtpLoading(true);
    try {
      const data = await api.verifyMfa(otp, rememberDevice);
      setUser(data.user);
      navigate(data.user.role === 'admin' ? '/admin' : '/overview');
    } catch (err) {
      // Check for session expired error
      if (err.status === 401 && err.message &&
          (err.message.includes('MFA session expired') || err.message.includes('log in again'))) {
        setStep('password');
        setError(err.message);
        setOtp('');
        setOtpError('');
      } else {
        setOtpError(err.message || 'Invalid or expired code');
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResend = async () => {
    setOtpError('');
    setResendMsg('');
    try {
      await api.sendMfaCode();
      setResendMsg('✓ Code resent to your email');
    } catch (err) {
      setOtpError(err.message || 'Failed to resend code');
    }
  };

  const handleResetRequest = async (e) => {
    e.preventDefault();
    setError(''); setResetMessage(''); setLoading(true);
    try {
      const data = await api.requestPasswordReset(resetEmail);
      setResetMessage(data.message);
      setStep('forgot_code');
    } catch (err) { setError(err.message || 'Unable to request a reset code'); }
    finally { setLoading(false); }
  };

  const handleResetCode = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.verifyPasswordReset(resetCode);
      setStep('forgot_new');
      setResetMessage('Email verified. Choose a new password.');
    } catch (err) { setError(err.message || 'Invalid or expired verification code'); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (resetPassword !== resetConfirm) return setError('Passwords do not match');
    if (resetPassword.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    try {
      await api.completePasswordReset(resetPassword);
      setStep('password');
      setForm(current => ({ ...current, email: resetEmail, password: '' }));
      setResetCode(''); setResetPassword(''); setResetConfirm('');
      setResetMessage('Password updated. Sign in with your new password.');
    } catch (err) { setError(err.message || 'Unable to reset password'); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo/Header */}
        <div className="auth-header">
          <img
            src="/icon.png?v=1"
            alt="SimplerFinance"
            className="auth-brand-icon"
          />
          <h1 className="auth-title">
            SimplerFinance
          </h1>
          <p className="auth-brand-tagline">Your financial life, on your infrastructure.</p>
          <p className="auth-subtitle">
            {step === 'password' ? 'Sign in to your account' : step === 'otp' ? 'Verify your identity' : 'Reset your password'}
          </p>
        </div>

        {step === 'password' && (
          <>
            {error && (
              <div className={`auth-alert ${isLocked ? 'warning' : 'error'}`}>
                {isLocked && <strong>⚠️ Account temporarily blocked. </strong>}
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="form-input"
                  placeholder="you@example.com"
                  maxLength={254}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="form-input"
                  placeholder="••••••••"
                  maxLength={1024}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn-primary auth-primary-button"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            {resetMessage && <div className="auth-inline-success">{resetMessage}</div>}
            <button type="button" onClick={() => { setStep('forgot_email'); setResetEmail(form.email); setError(''); setResetMessage(''); }} className="auth-link-button auth-forgot-link">
              Forgot password?
            </button>

            <p className="auth-switch-copy">
              No account?{' '}
              <Link to="/register" className="auth-text-link">
                Create one
              </Link>
            </p>
          </>
        )}

        {step === 'forgot_email' && (
          <form onSubmit={handleResetRequest}>
            <p className="auth-instructions">Enter your email. If an account exists, we’ll send a six-digit reset code.</p>
            <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={resetEmail} onChange={e => setResetEmail(e.target.value)} maxLength={254} autoComplete="email" required autoFocus /></div>
            {error && <div className="auth-form-error">{error}</div>}
            <button type="submit" className="btn-primary auth-primary-button" disabled={loading}>{loading ? 'Sending…' : 'Send reset code'}</button>
            <button type="button" onClick={() => { setStep('password'); setError(''); }} className="auth-link-button auth-back-link">← Back to sign in</button>
          </form>
        )}

        {step === 'forgot_code' && (
          <form onSubmit={handleResetCode}>
            <p className="auth-instructions compact">{resetMessage}</p>
            <div className="form-group"><label className="form-label">Verification code</label><input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="form-input auth-code-input" value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" required autoFocus /></div>
            {error && <div className="auth-form-error">{error}</div>}
            <button type="submit" className="btn-primary auth-primary-button" disabled={loading || resetCode.length !== 6}>{loading ? 'Verifying…' : 'Verify code'}</button>
            <button type="button" onClick={() => { setStep('forgot_email'); setError(''); setResetCode(''); }} className="auth-link-button auth-back-link">Request another code</button>
          </form>
        )}

        {step === 'forgot_new' && (
          <form onSubmit={handleResetPassword}>
            <p className="auth-instructions">{resetMessage}</p>
            <div className="form-group"><label className="form-label">New password</label><input type="password" className="form-input" value={resetPassword} onChange={e => setResetPassword(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required autoFocus /></div>
            <div className="form-group"><label className="form-label">Confirm new password</label><input type="password" className="form-input" value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></div>
            {error && <div className="auth-form-error">{error}</div>}
            <button type="submit" className="btn-primary auth-primary-button" disabled={loading}>{loading ? 'Updating…' : 'Set new password'}</button>
          </form>
        )}

        {step === 'otp' && (
          <>
            <div className="auth-code-notice">
              <div className="auth-code-notice-icon">📧</div>
              <p>
                Check your email for a 6-digit verification code
              </p>
            </div>

            <form onSubmit={handleOtpSubmit}>
              <div className="form-group">
                <label className="form-label">Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="form-input auth-code-input auth-code-input-large"
                  placeholder="000000"
                  autoFocus
                  required
                />
              </div>
              <label className="mfa-remember-device">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                />
                <span>
                  <strong>Remember this device for 30 days</strong>
                  <small>Skip email verification on this browser. Avoid using this on a shared device.</small>
                </span>
              </label>

              {otpError && (
                <div className="auth-alert error compact">
                  {otpError}
                </div>
              )}

              {resendMsg && (
                <div className="auth-alert success compact">
                  {resendMsg}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary auth-primary-button"
                disabled={otpLoading}
              >
                {otpLoading ? 'Verifying...' : 'Verify Code'}
              </button>
            </form>

            <div className="auth-secondary-actions">
              <button
                type="button"
                onClick={handleResend}
                className="auth-link-button emphasized"
              >
                Resend code
              </button>
              <span className="auth-action-separator">•</span>
              <button
                type="button"
                onClick={() => {
                  setStep('password');
                  setOtp('');
                  setOtpError('');
                  setResendMsg('');
                }}
                className="auth-link-button"
              >
                ← Back to login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
