import React, { useEffect, useMemo, useState } from 'react';

const NEWS_POLL_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function Segment({ tone = 'ok', label, hint, onClick }) {
  return (
    <button
      type="button"
      className={`status-strip-seg ${tone}`}
      onClick={onClick || undefined}
      disabled={!onClick}
      title={hint || undefined}
    >
      <span className="status-strip-seg-label">{label}</span>
      {hint && tone !== 'ok' && <span className="status-strip-seg-hint">{hint}</span>}
    </button>
  );
}

/**
 * Slim always-visible health strip: copying state, Telegram, MetaTrader,
 * active channels, and the next news-guard block window.
 * Lifts state the pages already have; only polls the cached fundamentals
 * dashboard (every 5 min) for the news countdown.
 */
export default function StatusStrip({
  telegramConnected = false,
  mt5Connected = false,
  enabledChannelsCount = 0,
  onNavigate = () => {}
}) {
  const [settings, setSettings] = useState(null);
  const [newsEvents, setNewsEvents] = useState(null); // { fetchedAtMs, events: [{impact, minutesToEvent}] }
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    window.electronAPI?.getSettings?.().then((s) => { if (active) setSettings(s || null); }).catch(() => {});
    const unsub = window.electronAPI?.onSettingsUpdated?.((next) => {
      if (next) setSettings(next);
    });
    return () => {
      active = false;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const guardEnabled = settings ? settings.enableHighImpactNewsGuard !== false : true;

  useEffect(() => {
    if (!guardEnabled) return undefined;
    let active = true;
    const load = () => {
      window.electronAPI?.getFundamentalsDashboard?.({}).then((payload) => {
        if (!active) return;
        const events = Array.isArray(payload?.calendar?.events) ? payload.calendar.events : [];
        setNewsEvents({
          fetchedAtMs: Date.now(),
          events: events
            .filter((evt) => Number(evt?.impact || 0) >= 3 && Number.isFinite(Number(evt?.minutesToEvent)))
            .map((evt) => ({ minutesToEvent: Number(evt.minutesToEvent) }))
        });
      }).catch(() => {
        if (active) setNewsEvents(null);
      });
    };
    // Defer first fetch so startup IPC (settings, trades) is not queued behind a slow fundamentals pull.
    const defer = setTimeout(load, 3000);
    const t = setInterval(load, NEWS_POLL_MS);
    return () => { active = false; clearTimeout(defer); clearInterval(t); };
  }, [guardEnabled]);

  // Re-render every 30s so the countdown stays current between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const news = useMemo(() => {
    if (!guardEnabled) return { tone: 'muted', text: 'News guard off' };
    if (!newsEvents) return { tone: 'muted', text: 'News guard on' };
    const beforeMin = Math.max(0, Number(settings?.highImpactNewsBlockBeforeMinutes ?? 30) || 0);
    const afterMin = Math.max(0, Number(settings?.highImpactNewsBlockAfterMinutes ?? 15) || 0);
    const elapsedMin = (Date.now() - newsEvents.fetchedAtMs) / 60000;
    let blockingEndsIn = null; // minutes until current block window ends
    let nextBlockIn = null; // minutes until the next block window starts
    for (const evt of newsEvents.events) {
      const m = evt.minutesToEvent - elapsedMin; // minutes to the event right now
      if (m >= -afterMin && m <= beforeMin) {
        const endsIn = m + afterMin;
        if (blockingEndsIn == null || endsIn > blockingEndsIn) blockingEndsIn = endsIn;
      } else if (m > beforeMin) {
        const startsIn = m - beforeMin;
        if (nextBlockIn == null || startsIn < nextBlockIn) nextBlockIn = startsIn;
      }
    }
    if (blockingEndsIn != null) {
      return {
        tone: 'warn',
        text: `News guard: blocking now (~${fmtMinutes(blockingEndsIn)} left)`,
        hint: 'High-impact news window — new signals are blocked until it passes.'
      };
    }
    if (nextBlockIn != null && nextBlockIn <= 12 * 60) {
      return { tone: 'ok', text: `News guard: next block in ${fmtMinutes(nextBlockIn)}` };
    }
    return { tone: 'ok', text: 'News guard: no high-impact news soon' };
  }, [guardEnabled, newsEvents, settings?.highImpactNewsBlockBeforeMinutes, settings?.highImpactNewsBlockAfterMinutes]);

  const hasChannel = Number(enabledChannelsCount) > 0;
  const copying = telegramConnected && mt5Connected && hasChannel;
  const copyingHint = copying
    ? ''
    : !telegramConnected
      ? 'Telegram is not connected'
      : !mt5Connected
        ? 'MetaTrader is offline'
        : 'No channels enabled';

  return (
    <div className="status-strip" data-testid="status-strip">
      <Segment
        tone={copying ? 'ok' : 'bad'}
        label={copying ? 'Copying ON' : 'Copying OFF'}
        hint={copyingHint}
        onClick={() => onNavigate('trades')}
      />
      <Segment
        tone={telegramConnected ? 'ok' : 'bad'}
        label={telegramConnected ? 'Telegram ✓' : 'Telegram ✗'}
        hint={telegramConnected ? '' : 'Not connected — open the Telegram page to sign in'}
        onClick={() => onNavigate('telegram')}
      />
      <Segment
        tone={mt5Connected ? 'ok' : 'bad'}
        label={mt5Connected ? 'MetaTrader ✓' : 'MetaTrader ✗'}
        hint={mt5Connected ? '' : 'Offline — is the EA running on a chart with Algo Trading on?'}
        onClick={() => onNavigate('connections')}
      />
      <Segment
        tone={hasChannel ? 'ok' : 'warn'}
        label={hasChannel
          ? `${enabledChannelsCount} channel${Number(enabledChannelsCount) === 1 ? '' : 's'} active`
          : 'No channels enabled'}
        hint={hasChannel ? '' : 'Enable at least one channel to start copying'}
        onClick={() => onNavigate('telegram')}
      />
      <Segment
        tone={news.tone === 'warn' ? 'warn' : news.tone === 'muted' ? 'muted' : 'ok'}
        label={news.text}
        hint={news.hint || ''}
        onClick={() => onNavigate('fundamentals')}
      />
    </div>
  );
}
