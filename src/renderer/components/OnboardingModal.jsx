import React, { useState, useEffect, useLayoutEffect, useCallback, useId } from 'react';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Trade Station',
    subtitle: 'Your automated trading bridge',
    info: 'Trade Station copies trading signals from Telegram to MetaTrader and tracks execution in one operator-focused workspace.',
    icon: '👋',
    target: null,
    position: 'center',
    hint: null
  },
  {
    id: 'account',
    title: 'Account selection',
    subtitle: 'Focus charts & trades',
    info: 'Pick which linked MT5 accounts feed dashboards and tables. Multi-select compares portfolios.',
    icon: '👤',
    target: 'account-scope-picker',
    position: 'top-right',
    hint: '“All accounts” shows combined activity.'
  },
  {
    id: 'navigation',
    title: 'Navigation',
    subtitle: 'Ten workspaces',
    info: 'Dashboard (portfolio KPIs), Trades (execution monitor), Filter Lab, AI, Calendar (period stats), Channels, Fundamentals (macro guard rails), Connections, Telegram, and Settings — tab state is preserved when you switch.',
    icon: '🧭',
    target: 'sidebar',
    position: 'left',
    hint: null
  },
  {
    id: 'dashboard-main',
    title: 'Portfolio dashboard',
    subtitle: 'Charts, tables & slices',
    info: 'Use this canvas for portfolio intelligence: KPI pills, trade grids, profit curves, and hourly maps — all respect your selected accounts and slice chips.',
    icon: '📊',
    target: 'dashboard-workspace',
    position: 'left',
    hint: null
  },
  {
    id: 'dashboard-toolbar',
    title: 'Dashboard header',
    subtitle: 'Scope & notifications',
    info: 'Pick date scope (Day → All), skim unread alerts, and jump into settings-driven workflows without leaving the dashboard.',
    icon: '🛎️',
    target: 'page-header',
    position: 'top',
    hint: null
  },
  {
    id: 'calendar',
    title: 'Calendar workspace',
    subtitle: 'Week / month discipline',
    info: 'Explore performance by calendar period with summary tiles, day/week grids, and filters aligned to your trading journal workflow.',
    icon: '📅',
    target: 'calendar-workspace',
    position: 'top',
    hint: null
  },
  {
    id: 'fundamentals',
    title: 'Fundamentals workspace',
    subtitle: 'Macro & news guard context',
    info: 'Monitor bias screener output, upcoming macro prints, sentiment feeds, and AI headlines — pair-aware context before risking capital.',
    icon: '🏛️',
    target: 'fundamentals-workspace',
    position: 'left',
    hint: null
  },
  {
    id: 'trades-header',
    title: 'Trades workspace toolbar',
    subtitle: 'Imports & alerts',
    info: 'Refresh executions, import MT HTML statements, triage notifications, and align scope filters with the trades grid beneath.',
    icon: '🎯',
    target: 'page-header-trades',
    position: 'top',
    hint: null
  },
  {
    id: 'trades-body',
    title: 'Execution monitor',
    subtitle: 'Filters, slices & bulk actions',
    info: 'Tabs isolate Live vs Closed vs Blocked flows. Slice chips intersect analytics + table rows. Bulk Resend/Delete only touches rows visible after filters.',
    icon: '📋',
    target: 'trades-workspace',
    position: 'left',
    hint: 'Toolbar counts visible rows; widen filters if selections look “missing”.'
  },
  {
    id: 'status',
    title: 'Connections & session pulse',
    subtitle: 'Right-rail telemetry',
    info: 'See MT5 bridge health, balances from snapshots, and analytics-derived performance metrics at a glance.',
    icon: '📡',
    target: 'status-panel',
    position: 'right',
    hint: null
  },
  {
    id: 'logs',
    title: 'Activity logs',
    subtitle: 'Trace automation decisions',
    info: 'Structured INFO / WARN / ERROR rails capture bridge chatter and guard triggers — filter chips keep investigations tight.',
    icon: '📝',
    target: 'activity-logs',
    position: 'bottom',
    hint: null
  },
  {
    id: 'telegram',
    title: 'Telegram sourcing',
    subtitle: 'Authorized channels only',
    info: 'Connect Telegram once, enumerate dialogs, and toggle exactly which channels may enqueue trades.',
    icon: '💬',
    target: 'telegram-workspace',
    position: 'left',
    hint: null
  },
  {
    id: 'connections',
    title: 'Broker connections',
    subtitle: 'Saved profiles & EA discovery',
    info: 'Maintain funded/direct credential bundles and reconcile EA-discovered accounts against your registry.',
    icon: '🔌',
    target: 'connections-workspace',
    position: 'bottom',
    hint: null
  },
  {
    id: 'risk',
    title: 'Risk & automation limits',
    subtitle: 'Central guardrails',
    info: 'Lots, caps, schedule/news guards, and symbol maps live here — every outbound trade respects these gates.',
    icon: '🛡️',
    target: 'settings-page',
    position: 'bottom',
    hint: null
  },
  {
    id: 'done',
    title: 'You are set',
    subtitle: 'Tour hidden until you replay it',
    info: 'Finished tours stay dismissed on this device. Reopen anytime from Settings → “Replay product tour”.',
    icon: '🎉',
    target: null,
    position: 'center',
    hint: null
  }
];

const TARGET_NAVIGATION_PAGE = {
  'settings-page': 'settings',
  'account-scope-picker': 'dashboard',
  'page-header': 'dashboard',
  'dashboard-workspace': 'dashboard',
  'calendar-workspace': 'calendar',
  'fundamentals-workspace': 'fundamentals',
  'page-header-trades': 'trades',
  'trades-workspace': 'trades',
  'status-panel': 'trades',
  'activity-logs': 'trades',
  'telegram-workspace': 'telegram',
  'connections-workspace': 'connections'
};

const SPOTLIGHT_PAD = 10;
const DIM = 'rgba(0, 0, 0, 0.8)';

function focusTourTarget(el) {
  if (!el) return;
  const cand = el.matches(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
  )
    ? el
    : el.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
  try {
    cand?.focus({ preventScroll: true });
  } catch (_) {
    /* noop */
  }
}

function OnboardingSpotlightLayer({ rect, maskId }) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  if (!rect || vw <= 0 || vh <= 0) return null;

  const x = Math.max(0, rect.left - SPOTLIGHT_PAD);
  const y = Math.max(0, rect.top - SPOTLIGHT_PAD);
  const w = Math.min(vw - x, rect.width + SPOTLIGHT_PAD * 2);
  const h = Math.min(vh - y, rect.height + SPOTLIGHT_PAD * 2);
  const rx = 12;

  return (
    <svg
      className="onboarding-spotlight-svg"
      width={vw}
      height={vh}
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: 10040 }}
    >
      <defs>
        <mask id={maskId}>
          <rect width={vw} height={vh} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={rx} ry={rx} fill="black" />
        </mask>
      </defs>
      <rect width={vw} height={vh} fill={DIM} mask={`url(#${maskId})`} />
    </svg>
  );
}

function OnboardingSpotlightRing({ rect }) {
  if (!rect) return null;
  const x = rect.left - SPOTLIGHT_PAD;
  const y = rect.top - SPOTLIGHT_PAD;
  const w = rect.width + SPOTLIGHT_PAD * 2;
  const h = rect.height + SPOTLIGHT_PAD * 2;
  return (
    <div
      className="onboarding-spotlight-ring"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`
      }}
      aria-hidden
    />
  );
}

export default function OnboardingModal({ onComplete, onSkip, onNavigatePage }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [spotRect, setSpotRect] = useState(null);
  const [dontShowOnSkip, setDontShowOnSkip] = useState(true);
  const maskReactId = useId().replace(/:/g, '');
  const maskId = `onboarding-spot-mask-${maskReactId}`;

  const step = STEPS[currentStep];

  useEffect(() => {
    const target = step?.target;
    if (!target) return;
    const page = TARGET_NAVIGATION_PAGE[target];
    if (page) onNavigatePage?.(page);
  }, [currentStep, step?.target, onNavigatePage]);

  const measureTarget = useCallback(() => {
    if (!step?.target) {
      setSpotRect(null);
      return;
    }
    const el = document.querySelector(`[data-onboarding="${step.target}"]`);
    if (!el || !(el instanceof HTMLElement)) {
      setSpotRect(null);
      return;
    }
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (_) {
      /* noop */
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) {
      setSpotRect(null);
      return;
    }
    setSpotRect({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height
    });
    focusTourTarget(el);
  }, [step?.target]);

  useLayoutEffect(() => {
    measureTarget();
    const t = window.setTimeout(measureTarget, 80);
    const t2 = window.setTimeout(measureTarget, 280);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
    };
  }, [measureTarget, currentStep]);

  useEffect(() => {
    const onResize = () => measureTarget();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureTarget]);

  const handleNext = async () => {
    if (currentStep === STEPS.length - 1) {
      await onComplete?.();
      return;
    }
    setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkipClick = async () => {
    await onSkip?.({ persist: dontShowOnSkip });
  };

  const hasSpotlight = Boolean(step?.target && spotRect);

  return (
    <div className="onboarding-tour-root" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      {!step?.target && <div className="onboarding-dim-full" aria-hidden />}
      {hasSpotlight && (
        <>
          <OnboardingSpotlightLayer rect={spotRect} maskId={maskId} />
          <OnboardingSpotlightRing rect={spotRect} />
        </>
      )}

      <div className={`onboarding-card position-${step.position}`}>
        <div className="onboarding-card-header">
          <span className="onboarding-step-icon">{step.icon}</span>
          <div className="onboarding-step-info">
            <span className="onboarding-step-counter">Step {currentStep + 1} of {STEPS.length}</span>
            <h3 id="onboarding-title">{step.title}</h3>
            <p className="onboarding-subtitle">{step.subtitle}</p>
          </div>
        </div>

        <div className="onboarding-card-body">
          <p className="onboarding-info">{step.info}</p>

          {step.hint && (
            <div className="onboarding-hint">
              <span className="hint-arrow">→</span>
              <span>{step.hint}</span>
            </div>
          )}
        </div>

        <label className="onboarding-skip-persist">
          <input
            type="checkbox"
            checked={dontShowOnSkip}
            onChange={(e) => setDontShowOnSkip(e.target.checked)}
          />
          <span>Don&apos;t show this tour again if I skip</span>
        </label>

        <div className="onboarding-card-footer">
          <div className="onboarding-tour-dots" aria-hidden>
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                className={`tour-dot ${idx <= currentStep ? 'active' : ''} ${idx === currentStep ? 'current' : ''}`}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            {currentStep > 0 && currentStep < STEPS.length - 1 && (
              <button type="button" className="btn btn-ghost" onClick={handleBack}>← Back</button>
            )}
            <button type="button" className="btn btn-primary" onClick={handleNext}>
              {currentStep === STEPS.length - 1 ? 'Get Started' : 'Next →'}
            </button>
          </div>
        </div>
      </div>

      <button type="button" className="onboarding-skip-btn" onClick={handleSkipClick}>
        Skip tour
      </button>
    </div>
  );
}
