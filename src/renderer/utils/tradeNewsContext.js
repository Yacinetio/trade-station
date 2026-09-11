/** Format persisted trade.newsContext for UI tooltips and detail panels. */

export function getTradeNewsContext(trade = {}) {
  const ctx = trade?.newsContext;
  if (!ctx || typeof ctx !== 'object') return null;
  const label = String(ctx.label || '').trim();
  if (!label) return null;
  return ctx;
}

export function formatTradeNewsContextLabel(trade = {}) {
  const ctx = getTradeNewsContext(trade);
  return ctx?.label || '';
}

export function formatTradeNewsContextDetail(trade = {}) {
  const ctx = getTradeNewsContext(trade);
  if (!ctx) return '';
  const parts = [ctx.label];
  if (ctx.title && !String(ctx.label || '').includes(ctx.title)) {
    parts.push(ctx.title);
  }
  if (ctx.blocked) {
    parts.push('Trade blocked during news guard window.');
  } else if (Number.isFinite(ctx.minutesAgo)) {
    parts.push(`Released ${ctx.minutesAgo}m before this signal (outside block window).`);
  }
  return parts.filter(Boolean).join(' · ');
}

export function tradeHasNewsContext(trade = {}) {
  return Boolean(getTradeNewsContext(trade));
}
