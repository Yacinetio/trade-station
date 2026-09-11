// Trade export: CSV / JSON / PDF builders for a user-selected slice of trades.
// CSV/JSON builders are pure (string in/out) so they stay unit-testable;
// the PDF writer streams to disk via pdfkit.
const fs = require('fs');

const CSV_COLUMNS = [
  { key: 'id', label: 'id', get: (t) => t.id },
  { key: 'openedAt', label: 'openedAt', get: (t) => t.openedAt || t.time || '' },
  { key: 'closedAt', label: 'closedAt', get: (t) => t.closedAt || '' },
  { key: 'channel', label: 'channel', get: (t) => t.channel || '' },
  { key: 'symbol', label: 'symbol', get: (t) => t.symbol || '' },
  { key: 'type', label: 'type', get: (t) => t.type || '' },
  { key: 'orderType', label: 'orderType', get: (t) => t.orderType || '' },
  { key: 'status', label: 'status', get: (t) => t.status || '' },
  { key: 'entry', label: 'entry', get: (t) => t.entry ?? '' },
  { key: 'sl', label: 'sl', get: (t) => t.sl ?? '' },
  { key: 'tp', label: 'tp', get: (t) => (Array.isArray(t.tp) ? t.tp.join('; ') : (t.tp ?? '')) },
  { key: 'lot', label: 'lot', get: (t) => t.lot ?? '' },
  { key: 'profit', label: 'profit', get: (t) => t.profit ?? '' },
  { key: 'riskUsd', label: 'riskUsd', get: (t) => t.riskUsd ?? '' },
  { key: 'plannedRR', label: 'plannedRR', get: (t) => t.plannedRR ?? '' },
  { key: 'realizedR', label: 'realizedR', get: (t) => t.realizedR ?? '' },
  { key: 'timeframe', label: 'timeframe', get: (t) => t.timeframe || '' },
  { key: 'setup', label: 'setup', get: (t) => (Array.isArray(t.presetTags) && t.presetTags.length ? t.presetTags.join('; ') : (t.setup || '')) },
  { key: 'tags', label: 'tags', get: (t) => (Array.isArray(t?.journal?.tags) ? t.journal.tags.join('; ') : '') },
  { key: 'blockedReason', label: 'blockedReason', get: (t) => t.blockedReason || '' },
  { key: 'comment', label: 'comment', get: (t) => t.comment || '' },
  { key: 'accountKey', label: 'accountKey', get: (t) => t.accountKey || 'unknown' }
];

function toCsvRow(values = []) {
  return values.map((v) => {
    const raw = String(v ?? '');
    if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
    return raw;
  }).join(',');
}

function buildTradesCsv(trades = []) {
  const header = toCsvRow(CSV_COLUMNS.map((c) => c.label));
  const rows = (Array.isArray(trades) ? trades : []).map((t) => toCsvRow(CSV_COLUMNS.map((c) => c.get(t || {}))));
  return `${header}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function buildTradesJson(trades = []) {
  const list = Array.isArray(trades) ? trades : [];
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    tradeCount: list.length,
    trades: list
  }, null, 2);
}

function summarizeTrades(trades = []) {
  const list = Array.isArray(trades) ? trades : [];
  const closed = list.filter((t) => {
    const s = String(t?.status || '').toUpperCase();
    return s.includes('CLOSED') || s.includes('TP_HIT') || s.includes('SL_HIT');
  });
  const totalPnl = closed.reduce((sum, t) => sum + (Number(t?.profit) || 0), 0);
  const wins = closed.filter((t) => Number(t?.profit) > 0).length;
  return {
    tradeCount: list.length,
    closedCount: closed.length,
    totalPnl,
    winRate: closed.length ? (wins / closed.length) * 100 : 0
  };
}

const PDF_MAX_ROWS = 500;

function writeTradesPdf(trades = [], filePath, { title = 'Trade Station — Trade Export' } = {}) {
  // Lazy require keeps startup cost down (pdfkit is heavy).
  const PDFDocument = require('pdfkit');
  const summary = summarizeTrades(trades);
  const doc = new PDFDocument({ margin: 36 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(18).text(title);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toLocaleString()}`);
  doc.moveDown();
  doc.fillColor('#111').fontSize(12).text(`Trades: ${summary.tradeCount}`);
  doc.text(`Closed: ${summary.closedCount}`);
  doc.text(`Total P&L: ${summary.totalPnl.toFixed(2)}$`);
  doc.text(`Win rate: ${summary.winRate.toFixed(1)}%`);
  doc.moveDown();

  const list = (Array.isArray(trades) ? trades : []).slice(0, PDF_MAX_ROWS);
  doc.fontSize(13).text(`Trades${trades.length > PDF_MAX_ROWS ? ` (first ${PDF_MAX_ROWS} of ${trades.length})` : ''}`);
  doc.moveDown(0.4);
  for (const t of list) {
    const tp = Array.isArray(t?.tp) ? t.tp.join('/') : (t?.tp ?? '-');
    const line = `${t?.openedAt || t?.time || ''} | ${t?.symbol || '-'} ${t?.type || '-'} | ${t?.status || '-'}`
      + ` | E:${t?.entry ?? '-'} SL:${t?.sl ?? '-'} TP:${tp} Lot:${t?.lot ?? '-'}`
      + ` | ${(Number(t?.profit) || 0).toFixed(2)}$ | ${t?.channel || '-'}`;
    doc.fontSize(8).fillColor('#111').text(line, { lineGap: 2 });
  }
  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ filePath }));
    stream.on('error', reject);
  });
}

module.exports = {
  buildTradesCsv,
  buildTradesJson,
  summarizeTrades,
  writeTradesPdf,
  CSV_COLUMNS
};
