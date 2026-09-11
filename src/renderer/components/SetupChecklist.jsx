import React, { useEffect, useMemo, useState } from 'react';

const DISMISS_KEY = 'ts-setup-checklist-dismissed';
const SESSION_HIDE_KEY = 'ts-setup-checklist-session-hidden';

const EA_INSTRUCTIONS = [
  'Open MetaTrader 5 → File → Open Data Folder.',
  'Copy SignalCopierEA.ex5 into MQL5/Experts.',
  'Restart MetaTrader (or right-click Expert Advisors → Refresh), then drag SignalCopierEA onto any chart.',
  'Enable Algo Trading — the toolbar button must be green.',
  'Keep MetaTrader running. This card turns green automatically once it connects.'
];

function readFlag(storage, key) {
  try { return storage.getItem(key) === '1'; } catch (_) { return false; }
}
function writeFlag(storage, key, on) {
  try {
    if (on) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch (_) { /* noop */ }
}

function StepIcon({ done }) {
  return (
    <span className={`setup-step-icon ${done ? 'done' : 'pending'}`} aria-hidden>
      {done ? '✓' : '●'}
    </span>
  );
}

/**
 * Guided first-run checklist: Telegram → EA → channel → live.
 * Shown on the Dashboard while setup is incomplete; reachable any time
 * from the sidebar "Setup" button.
 */
export default function SetupChecklist({
  telegramConnected = false,
  mt5Connected = false,
  enabledChannelsCount = 0,
  currentPage = '',
  forcedOpen = false,
  onClose = () => {},
  onNavigate = () => {},
  onConnectTelegram = () => {}
}) {
  const hasChannel = Number(enabledChannelsCount) > 0;
  const allComplete = telegramConnected && mt5Connected && hasChannel;

  const [dismissed, setDismissed] = useState(() => readFlag(window.localStorage, DISMISS_KEY));
  const [sessionHidden, setSessionHidden] = useState(() => readFlag(window.sessionStorage, SESSION_HIDE_KEY));
  const [eaStepsOpen, setEaStepsOpen] = useState(false);

  /** A prerequisite broke after the card was dismissed → bring it back. */
  useEffect(() => {
    if (!allComplete && dismissed) {
      writeFlag(window.localStorage, DISMISS_KEY, false);
      setDismissed(false);
    }
  }, [allComplete, dismissed]);

  const steps = useMemo(() => ([
    {
      id: 'telegram',
      label: 'Connect Telegram',
      done: telegramConnected,
      hint: telegramConnected
        ? 'Telegram is connected.'
        : 'Sign in once so Trade Station can read your signal channels.',
      onClick: () => {
        if (telegramConnected) onNavigate('telegram');
        else onConnectTelegram();
      }
    },
    {
      id: 'ea',
      label: 'Install the EA in MetaTrader',
      done: mt5Connected,
      hint: mt5Connected
        ? 'MetaTrader is connected.'
        : 'A 2-minute, one-time setup inside MetaTrader 5.',
      onClick: () => setEaStepsOpen((v) => !v),
      expandable: true
    },
    {
      id: 'channel',
      label: 'Enable a signal channel',
      done: hasChannel,
      hint: hasChannel
        ? `${enabledChannelsCount} channel${enabledChannelsCount === 1 ? '' : 's'} copying.`
        : 'Pick which Telegram channels are allowed to place trades.',
      onClick: () => onNavigate('telegram')
    },
    {
      id: 'ready',
      label: 'Ready',
      done: allComplete,
      hint: allComplete
        ? 'You\u2019re live. Signals will appear in Trades.'
        : 'Completes automatically when everything above is green.',
      onClick: allComplete ? () => onNavigate('trades') : null
    }
  ]), [telegramConnected, mt5Connected, hasChannel, enabledChannelsCount, allComplete, onNavigate, onConnectTelegram]);

  const doneCount = steps.filter((st) => st.done).length;
  const firstPendingId = steps.find((st) => !st.done)?.id || '';

  // Visibility: forced open always wins; otherwise show on the Dashboard
  // while setup is incomplete (unless hidden for this session), or when
  // complete-but-not-yet-dismissed so the user sees the "you're live" state.
  let visible = false;
  if (forcedOpen) visible = true;
  else if (currentPage === 'dashboard') {
    if (!allComplete) visible = !sessionHidden;
    else visible = !dismissed;
  }
  if (!visible) return null;

  const handleClose = () => {
    if (allComplete) {
      writeFlag(window.localStorage, DISMISS_KEY, true);
      setDismissed(true);
    } else {
      writeFlag(window.sessionStorage, SESSION_HIDE_KEY, true);
      setSessionHidden(true);
    }
    onClose();
  };

  return (
    <div className="setup-checklist" data-testid="setup-checklist" role="region" aria-label="Setup checklist">
      <div className="setup-checklist-head">
        <div>
          <div className="setup-checklist-title">
            {allComplete ? 'You\u2019re live 🎉' : 'Get set up'}
          </div>
          <div className="setup-checklist-sub">
            {allComplete
              ? 'Signals from your enabled channels will appear in Trades.'
              : `${doneCount} of ${steps.length} steps done`}
          </div>
        </div>
        <button
          type="button"
          className="setup-checklist-close"
          onClick={handleClose}
          title={allComplete ? 'Dismiss — setup is complete' : 'Hide for now (reopens from the Setup button)'}
          aria-label="Close setup checklist"
        >
          ×
        </button>
      </div>

      <div className="setup-checklist-progress" aria-hidden>
        <div className="setup-checklist-progress-fill" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <ol className="setup-checklist-steps">
        {steps.map((st) => {
          const isCurrent = st.id === firstPendingId;
          const showEaSteps = st.id === 'ea' && !st.done && (eaStepsOpen || isCurrent);
          return (
            <li key={st.id} className={`setup-step ${st.done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
              <button
                type="button"
                className="setup-step-row"
                onClick={st.onClick || undefined}
                disabled={!st.onClick}
              >
                <StepIcon done={st.done} />
                <span className="setup-step-main">
                  <span className="setup-step-label">{st.label}</span>
                  <span className="setup-step-hint">{st.hint}</span>
                </span>
                {st.expandable && !st.done && (
                  <span className="setup-step-chevron" aria-hidden>{showEaSteps ? '▾' : '▸'}</span>
                )}
              </button>
              {showEaSteps && (
                <ol className="setup-ea-steps">
                  {EA_INSTRUCTIONS.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
