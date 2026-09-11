import React, { useState } from 'react';

const STEPS = ['Phone Number', 'Verify Code', '2FA Password'];

export default function TelegramConnectModal({ onClose, onAuth }) {
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function handleSendCode(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!phone) return setError('Please enter your phone number.');
    setLoading(true);
    const res = await window.electronAPI?.sendCode(phone);
    setLoading(false);
    if (res?.success) {
      setPhoneCodeHash(res.phoneCodeHash);
      setStep(1);
      setInfo('Verification code sent to your Telegram app.');
    } else {
      setError(res?.error || 'Failed to send code. Check your phone format (+1234567890).');
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    if (!code) return setError('Please enter the verification code.');
    setLoading(true);
    const res = await window.electronAPI?.signIn(phone, phoneCodeHash, code);
    setLoading(false);
    if (res?.success) {
      onAuth({ phone });
    } else if (res?.needs2FA) {
      setStep(2);
      setError('');
    } else {
      setError(res?.error || 'Invalid code. Please try again.');
    }
  }

  async function handleVerify2FA(e) {
    e.preventDefault();
    setError('');
    if (!password) return setError('Please enter your 2FA password.');
    setLoading(true);
    const res = await window.electronAPI?.signInWith2FA(password);
    setLoading(false);
    if (res?.success) {
      onAuth({ phone });
    } else {
      setError(res?.error || 'Incorrect password. Please try again.');
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460, maxWidth: 'calc(100vw - 40px)' }}>
        <div className="modal-header">
          <h2>📡 Connect Telegram</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="step-indicator" style={{ marginBottom: 20 }}>
            {STEPS.slice(0, step === 2 ? 3 : 2).map((s, i) => (
              <React.Fragment key={s}>
                <div className={`step ${i < step ? 'done' : i === step ? 'active' : ''}`} title={s}>
                  {i < step ? '✓' : i + 1}
                </div>
                {i < (step === 2 ? 2 : 1) && <div className={`step-line ${i < step ? 'done' : ''}`} />}
              </React.Fragment>
            ))}
          </div>

          {step === 0 && (
            <form onSubmit={handleSendCode}>
              <div className="form-group">
                <label>Phone Number</label>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+1 234 567 8900"
                  type="tel"
                  autoFocus
                />
              </div>
              {error && <div className="error-msg">{error}</div>}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? '⏳ Sending code...' : '📤 Send Verification Code'}
              </button>
            </form>
          )}

          {step === 1 && (
            <form onSubmit={handleVerify}>
              {info && <div className="success-msg" style={{ marginBottom: 12 }}>{info}</div>}
              <div className="form-group">
                <label>Verification Code</label>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter code"
                  autoFocus
                />
              </div>
              {error && <div className="error-msg">{error}</div>}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? '⏳ Verifying...' : '✅ Connect Telegram'}
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleVerify2FA}>
              <div className="form-group">
                <label>Cloud Password (2FA)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your Telegram password"
                    autoFocus
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
                    }}
                    title={showPassword ? 'Hide' : 'Show'}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              {error && <div className="error-msg">{error}</div>}
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? '⏳ Verifying...' : '🛡️ Confirm Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
