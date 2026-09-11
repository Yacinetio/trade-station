import React, { useCallback, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

const EXIT_AFTER_MS = 3200;
const REMOVE_AFTER_MS = 3600;

/** Shared toast state — pair with <ToastContainer toasts={toasts} /> at page root. */
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info', title = '') => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type, title }]);
    setTimeout(() => setToasts((p) => p.map((t) => (t.id === id ? { ...t, exit: true } : t))), EXIT_AFTER_MS);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), REMOVE_AFTER_MS);
  }, []);
  return { toasts, push };
}

export function ToastContainer({ toasts = [] }) {
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICONS[t.type] || Info;
        return (
          <div key={t.id} className={`toast toast-${t.type}${t.exit ? ' toast-exit' : ''}`}>
            <span className="toast-icon"><Icon size={16} aria-hidden="true" /></span>
            <div className="toast-content">
              {t.title && <div className="toast-title">{t.title}</div>}
              <div className="toast-msg">{t.msg}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
