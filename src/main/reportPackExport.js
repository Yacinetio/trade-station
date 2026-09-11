/**
 * Weekly performance pack (CSV + PDF) written to Documents/TradeStation/exports.
 * Extracted from main.js; `documentsDir` is injected so this stays Electron-free.
 */
const fs = require('fs');
const path = require('path');

function toCsvRow(values = []) {
  return values.map((v) => {
    const raw = String(v ?? '');
    if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
    return raw;
  }).join(',');
}

function generateWeeklyPackFiles({ trades = [], analytics = null, documentsDir }) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const baseDir = path.join(documentsDir, 'TradeStation', 'exports');
  fs.mkdirSync(baseDir, { recursive: true });

  const csvPath = path.join(baseDir, `weekly-trades-${stamp}.csv`);
  const pdfPath = path.join(baseDir, `weekly-report-${stamp}.pdf`);

  const header = toCsvRow(['id', 'openedAt', 'symbol', 'type', 'status', 'timeframe', 'bias', 'presetTags', 'vwapBand', 'hvnBand', 'entry', 'sl', 'tp', 'lot', 'profit', 'channel', 'accountKey']);
  const rows = trades.map((t) => toCsvRow([
    t.id,
    t.openedAt || '',
    t.symbol || '',
    t.type || '',
    t.status || '',
    t.timeframe || '',
    t.bias || '',
    Array.isArray(t.presetTags) && t.presetTags.length ? t.presetTags.join('; ') : (t.setup || ''),
    t.vwapBand || '',
    t.hvnBand || '',
    t.entry ?? '',
    t.sl ?? '',
    t.tp ?? '',
    t.lot ?? '',
    t.profit ?? '',
    t.channel || '',
    t.accountKey || 'unknown'
  ]));
  fs.writeFileSync(csvPath, `${header}\n${rows.join('\n')}\n`, 'utf8');

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 36 });
  const pdfStream = fs.createWriteStream(pdfPath);
  doc.pipe(pdfStream);
  doc.fontSize(18).text('Trade Station Weekly Performance Report');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toLocaleString()}`);
  doc.moveDown();
  doc.fillColor('#111').fontSize(12).text(`Closed trades: ${Number(analytics?.closedCount || 0)}`);
  doc.text(`Total trades: ${Number(analytics?.tradeCount || 0)}`);
  doc.text(`Total P&L: ${Number(analytics?.totals?.totalPnl || 0).toFixed(2)}$`);
  doc.text(`Win rate: ${Number(analytics?.totals?.winRate || 0).toFixed(2)}%`);
  doc.text(`Avg R:R: 1:${Number(analytics?.totals?.rr || 0).toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(13).text('Top 20 Recent Trades');
  doc.moveDown(0.4);
  const list = [...trades].slice(0, 20);
  for (const t of list) {
    const line = `${t.openedAt || ''} | ${t.symbol || '-'} ${t.type || '-'} | ${t.status || '-'} | ${Number(t.profit || 0).toFixed(2)}$ | ${t.accountKey || 'unknown'}`;
    doc.fontSize(9).text(line, { lineGap: 2 });
  }
  doc.end();

  return new Promise((resolve, reject) => {
    pdfStream.on('finish', () => resolve({ csvPath, pdfPath, baseDir }));
    pdfStream.on('error', reject);
  });
}

module.exports = { generateWeeklyPackFiles, toCsvRow };
