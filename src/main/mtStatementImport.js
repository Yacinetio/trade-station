/**
 * Parses MetaTrader 4-style DetailedStatement.htm (Account History saved as HTML).
 * Imports rows under "Closed Transactions" only (open/working sections ignored).
 */

const fs = require('fs');
const { normalizeTradeForStorage } = require('./analyticsService');

/** Normalize broker-style numbers: "50 000.00", "-1 155.59", commas */
function parseMtAmount(raw) {
  let s = String(raw ?? '').replace(/\u00a0/g, ' ').trim();
  if (!s) return 0;
  while (/\d\s+\d/.test(s)) {
    s = s.replace(/(\d)\s+(?=\d)/g, '$1');
  }
  s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMtDateTime(raw, brokerOffsetMinutes = null) {
  const s = String(raw ?? '').trim();
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const ss = Number(m[6]);
  if (
    typeof brokerOffsetMinutes === 'number'
    && Number.isFinite(brokerOffsetMinutes)
  ) {
    const ms = Date.UTC(y, mo - 1, d, h, mi, ss) - brokerOffsetMinutes * 60 * 1000;
    const dt = new Date(ms);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const naive = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return Number.isNaN(naive.getTime()) ? null : naive;
}

function stripInnerHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTdCells(rowHtml) {
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const attrs = m[1] || '';
    const colspanMatch = attrs.match(/colspan\s*=\s*"?(\d+)"?/i);
    const colspan = colspanMatch ? Math.max(1, parseInt(colspanMatch[1], 10) || 1) : 1;
    const text = stripInnerHtml(m[2]);
    for (let i = 0; i < colspan; i++) cells.push(text);
  }
  return cells;
}

function extractRowTitle(rowHtml) {
  const m = String(rowHtml).match(/\btitle\s*=\s*"([^"]*)"/i);
  return m ? String(m[1]).trim().toLowerCase() : '';
}

function sliceClosedTransactions(html) {
  const idx = html.search(/Closed Transactions:/i);
  if (idx < 0) return '';
  const rest = html.slice(idx);
  const endMatch = rest.match(/<tr\s+align=left[^>]*>\s*<td\s+colspan=\d+[^>]*>\s*<b>\s*Open Trades:/i);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

function parseAccountMeta(html) {
  let login = '';
  const accMatch = html.match(/Account:\s*(\d{4,})/i);
  if (accMatch) login = accMatch[1];
  const titleMatch = html.match(/<title>[\s\S]*?Statement:\s*(\d{4,})/i);
  if (!login && titleMatch) login = titleMatch[1];

  let displayName = '';
  const nameMatch = html.match(/Name:\s*([^<\n]+)/i);
  if (nameMatch) displayName = nameMatch[1].trim();

  return { login, displayName };
}

function deriveCloseStatus(titleLc, netProfit, grossProfit) {
  if (titleLc.includes('[tp]')) return 'CLOSED_TP';
  if (titleLc.includes('[sl]')) return 'CLOSED_SL';
  if (titleLc.includes('so')) return 'CLOSED';
  const gp = Number(grossProfit);
  if (gp > 0) return 'CLOSED_TP';
  if (gp < 0) return 'CLOSED_SL';
  if (Number(netProfit) > 0) return 'CLOSED_TP';
  if (Number(netProfit) < 0) return 'CLOSED_SL';
  return 'CLOSED';
}

/**
 * @returns {{ login: string, displayName: string, trades: object[], skippedRows: number }}
 */
function parseMt4DetailedStatementHtml(html, options = {}) {
  const brokerOffsetMinutes = options.brokerOffsetMinutes ?? null;
  const { login: fallbackLogin = '', displayName: fallbackName = '' } = options;
  const meta = parseAccountMeta(html);
  const login = meta.login || String(fallbackLogin || '').trim();
  const displayName = meta.displayName || fallbackName;

  const chunk = sliceClosedTransactions(html);
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m;
  const trades = [];
  let skippedRows = 0;

  while ((m = rowRe.exec(chunk))) {
    const inner = m[2] || '';
    const rowHtml = `<tr>${inner}</tr>`;
    const cells = extractTdCells(inner);
    if (cells.length < 14) {
      skippedRows++;
      continue;
    }

    const typeLc = String(cells[2] || '').trim().toLowerCase();
    if (typeLc !== 'buy' && typeLc !== 'sell') {
      skippedRows++;
      continue;
    }

    const ticket = String(cells[0] || '').replace(/\s+/g, '').trim();
    if (!/^\d+$/.test(ticket)) {
      skippedRows++;
      continue;
    }

    const openDate = parseMtDateTime(cells[1], brokerOffsetMinutes);
    const closeDate = parseMtDateTime(cells[8], brokerOffsetMinutes);
    if (!openDate || !closeDate) {
      skippedRows++;
      continue;
    }

    const symbol = String(cells[4] || '').trim().toUpperCase();
    if (!symbol) {
      skippedRows++;
      continue;
    }

    const commission = parseMtAmount(cells[10]);
    const taxes = parseMtAmount(cells[11]);
    const swap = parseMtAmount(cells[12]);
    const grossProfit = parseMtAmount(cells[13]);
    const netProfit = grossProfit + commission + swap + taxes;

    const titleLc = extractRowTitle(rowHtml);
    const status = deriveCloseStatus(titleLc, netProfit, grossProfit);

    trades.push({
      ticket,
      symbol,
      side: typeLc === 'buy' ? 'BUY' : 'SELL',
      lot: parseMtAmount(cells[3]),
      entryPrice: parseMtAmount(cells[5]),
      sl: parseMtAmount(cells[6]),
      tp: parseMtAmount(cells[7]),
      closePrice: parseMtAmount(cells[9]),
      commission,
      taxes,
      swap,
      grossProfit,
      netProfit,
      status,
      openedAt: openDate.toISOString(),
      closedAt: closeDate.toISOString(),
      titleHint: titleLc || ''
    });
  }

  return { login, displayName, trades, skippedRows };
}

function resolveImportAccountKey(parsedLogin, targetAccountKey, knownAccounts = [], flavor = 'MT4') {
  const tgt = String(targetAccountKey || '').trim();
  if (tgt) return tgt;

  const loginStr = String(parsedLogin || '').trim();
  if (!loginStr) return '';

  const matches = knownAccounts.filter((a) => String(a?.login || '').trim() === loginStr);
  if (matches.length === 1) return matches[0].key;

  const suffix = flavor === 'MT5' ? 'MT5-Report' : 'MT4-Statement';
  return `${loginStr}@${suffix}`;
}

function statementRowsToTrades(rows, accountKey, meta = {}) {
  const {
    login = '',
    displayName = '',
    statementPath = '',
    sourceTag = 'MT4_HTML_STATEMENT'
  } = meta;
  return rows.map((r) => {
    const id = `stmt-${accountKey.replace(/[^a-zA-Z0-9@_-]/g, '_')}-${r.ticket}`;
    return normalizeTradeForStorage({
      id,
      symbol: r.symbol,
      type: r.side,
      entry: r.entryPrice,
      sl: r.sl > 0 ? r.sl : undefined,
      tp: r.tp > 0 ? r.tp : undefined,
      lot: r.lot,
      status: r.status,
      profit: Number(r.netProfit.toFixed(2)),
      commission: r.commission,
      swap: r.swap,
      taxes: r.taxes,
      openedAt: r.openedAt,
      lastUpdateAt: r.closedAt,
      closeTime: r.closedAt.slice(11, 19),
      channel: 'MT Statement',
      origin: 'IMPORT',
      source: sourceTag,
      mt5Ticket: r.ticket,
      mt5DealId: r.ticket,
      mt5PositionId: r.ticket,
      accountKey,
      accountLogin: login,
      accountServer: String(accountKey.split('@')[1] || ''),
      accountName: displayName,
      orderType: 'MARKET',
      statementImportPath: statementPath ? pathBasename(statementPath) : '',
      importHint: r.titleHint
    });
  });
}

function pathBasename(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * @param {object[]} existingTrades
 * @param {object[]} incoming normalized trades for same accountKey
 */
function mergeStatementImports(existingTrades, incoming) {
  const next = Array.isArray(existingTrades) ? [...existingTrades] : [];
  let added = 0;
  let skippedDup = 0;

  for (const row of incoming) {
    const ticket = String(row.mt5Ticket || '').trim();
    const ak = String(row.accountKey || '');
    const dup = next.some(
      (t) =>
        String(t.mt5Ticket || '').trim() === ticket &&
        String(t.accountKey || '') === ak &&
        ticket !== ''
    );
    if (dup) {
      skippedDup++;
      continue;
    }
    next.push(row);
    added++;
  }

  return { trades: next, added, skippedDup };
}

function parseMt5AccountMeta(html) {
  let login = '';
  const loginMatch =
    html.match(/\bLogin\s*[: ]\s*(\d{4,})\b/i) ||
    html.match(/\bAccount\s*[: ]\s*(\d{4,})\b/i) ||
    html.match(/Statement\s*:\s*(\d{4,})/i);
  if (loginMatch) login = loginMatch[1];

  let displayName = '';
  const nameMatch = html.match(/\bName\s*[: ]\s*([^<\n\r]{2,120})/i);
  if (nameMatch) displayName = nameMatch[1].trim();

  return { login, displayName };
}

function sliceMt5DealsChunk(html) {
  const markers = [/>\s*Deals\s*</i, /Deals\s*<\/b>/i];
  let idx = -1;
  for (const re of markers) {
    idx = html.search(re);
    if (idx >= 0) break;
  }
  if (idx < 0) return '';
  const rest = html.slice(idx);
  const endMatch = rest.match(
    /<tr[^>]*>\s*<td[^>]*colspan[^>]*>\s*<b>\s*(Open Positions|Working Orders|Orders|Positions)/i
  );
  const slice = endMatch ? rest.slice(0, endMatch.index) : rest.slice(0, Math.min(rest.length, 600000));
  return slice;
}

function normHeadCell(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headerMapFromCells(cells) {
  const map = {};
  cells.forEach((raw, i) => {
    const k = normHeadCell(raw).replace(/[^a-z0-9]+/g, '');
    if (!k) return;
    if (k.includes('time')) map.time = i;
    else if (k.includes('deal') && !k.includes('order')) map.deal = i;
    else if (k.includes('symbol')) map.symbol = i;
    else if (k.includes('volume')) map.volume = i;
    else if (k.includes('price')) map.price = i;
    else if (k.includes('order')) map.order = i;
    else if (k.includes('commission')) map.commission = i;
    else if (k.includes('swap')) map.swap = i;
    else if (k.includes('profit')) map.profit = i;
    else if (k === 'type' || k.includes('direction')) map.type = i;
  });
  return map;
}

function rowTdCells(inner) {
  const normalized = inner.replace(/<\/?th\b/gi, (m) => m.replace(/th/gi, 'td'));
  return extractTdCells(normalized);
}

/**
 * MT5 HTML trading report: tabular "Deals" section (Toolbox → History → Report).
 * Header row optional — falls back to fixed column order when detected.
 */
function parseMt5ReportDealsHtml(html, options = {}) {
  const brokerOffsetMinutes = options.brokerOffsetMinutes ?? null;
  const meta = parseMt5AccountMeta(html);
  const chunk = sliceMt5DealsChunk(html);
  const trades = [];
  let skippedRows = 0;
  if (!chunk) return { ...meta, trades, skippedRows };

  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m;
  let colMap = null;

  while ((m = rowRe.exec(chunk))) {
    const inner = m[2] || '';
    const cells = rowTdCells(inner);
    if (cells.length < 6) {
      skippedRows++;
      continue;
    }

    const headLike =
      cells.some((c) => normHeadCell(c).includes('symbol')) &&
      cells.some((c) => normHeadCell(c).includes('time') || normHeadCell(c).includes('volume'));

    if (headLike && cells.length >= 6) {
      colMap = headerMapFromCells(cells);
      if (colMap.symbol != null && colMap.time != null) continue;
      colMap = null;
    }

    if (!colMap || Object.keys(colMap).length < 4) {
      const t0 = String(cells[0] || '').trim();
      if (/^\d{4}\.\d{2}\.\d{2}/.test(t0) && cells.length >= 11) {
        colMap = {
          time: 0,
          deal: 1,
          symbol: 2,
          type: 3,
          direction: 4,
          volume: 5,
          price: 6,
          order: 7,
          commission: 8,
          swap: 9,
          profit: 10
        };
      } else {
        skippedRows++;
        continue;
      }
    }

    const sym = String(cells[colMap.symbol] || '')
      .trim()
      .toUpperCase();
    const typeRaw = String(cells[colMap.type != null ? colMap.type : 3] || '')
      .trim()
      .toLowerCase();

    if (!sym || sym === 'SYMBOL' || /balance|credit|dividend|correction/.test(typeRaw)) {
      skippedRows++;
      continue;
    }
    if (!/[A-Z]/.test(sym)) {
      skippedRows++;
      continue;
    }

    const timeStr = String(cells[colMap.time] || '').trim();
    const openDate = parseMtDateTime(timeStr, brokerOffsetMinutes);
    if (!openDate) {
      skippedRows++;
      continue;
    }

    let side = '';
    if (typeRaw.includes('buy')) side = 'BUY';
    else if (typeRaw.includes('sell')) side = 'SELL';
    if (!side && colMap.direction != null) {
      const d = String(cells[colMap.direction] || '').toLowerCase();
      if (d.includes('in') && d.includes('buy')) side = 'BUY';
      else if (d.includes('in') && d.includes('sell')) side = 'SELL';
      else if (d.includes('buy')) side = 'BUY';
      else if (d.includes('sell')) side = 'SELL';
    }
    if (!side) {
      skippedRows++;
      continue;
    }

    const dealRaw = colMap.deal != null ? cells[colMap.deal] : cells[1];
    const ticket = String(dealRaw || '')
      .replace(/\s+/g, '')
      .replace(/[^\d]/g, '')
      .trim();
    if (!ticket) {
      skippedRows++;
      continue;
    }

    const volIdx = colMap.volume != null ? colMap.volume : 5;
    const priceIdx = colMap.price != null ? colMap.price : 6;
    const profitIdx = colMap.profit != null ? colMap.profit : cells.length - 2;
    const commIdx = colMap.commission != null ? colMap.commission : Math.max(0, profitIdx - 2);
    const swapIdx = colMap.swap != null ? colMap.swap : Math.max(0, profitIdx - 1);

    const commission = parseMtAmount(cells[commIdx]);
    const swap = parseMtAmount(cells[swapIdx]);
    const grossProfit = parseMtAmount(cells[profitIdx]);
    const netProfit = grossProfit + commission + swap;

    const titleLc = extractRowTitle(`<tr>${inner}</tr>`);
    const status = deriveCloseStatus(titleLc, netProfit, grossProfit);

    trades.push({
      ticket,
      symbol: sym,
      side,
      lot: parseMtAmount(cells[volIdx]),
      entryPrice: parseMtAmount(cells[priceIdx]),
      sl: 0,
      tp: 0,
      closePrice: parseMtAmount(cells[priceIdx]),
      commission,
      taxes: 0,
      swap,
      grossProfit,
      netProfit,
      status,
      openedAt: openDate.toISOString(),
      closedAt: openDate.toISOString(),
      titleHint: typeRaw || titleLc
    });
  }

  return { ...meta, trades, skippedRows };
}

function parseDetailedStatementFromFile(filePath, opts = {}) {
  const html = fs.readFileSync(filePath, 'utf8');
  const brokerOffsetMinutes =
    typeof opts.brokerOffsetMinutes === 'number' && Number.isFinite(opts.brokerOffsetMinutes)
      ? Math.round(opts.brokerOffsetMinutes)
      : null;
  const importOpts = { brokerOffsetMinutes };
  let parsed = parseMt4DetailedStatementHtml(html, importOpts);
  let flavor = 'MT4';
  let sourceTag = 'MT4_HTML_STATEMENT';

  if (!parsed.trades.length || !parsed.login) {
    const mt5 = parseMt5ReportDealsHtml(html, importOpts);
    if (mt5.trades.length) {
      parsed = {
        login: mt5.login || parsed.login,
        displayName: mt5.displayName || parsed.displayName,
        trades: mt5.trades,
        skippedRows: mt5.skippedRows
      };
      flavor = 'MT5';
      sourceTag = 'MT5_HTML_REPORT';
    }
  }

  if (!parsed.login) {
    const snap = parseMt5AccountMeta(html);
    if (snap.login) {
      parsed = {
        ...parsed,
        login: snap.login,
        displayName: snap.displayName || parsed.displayName
      };
    }
  }

  if (!parsed.login) {
    const err = new Error(
      'Could not find account login in HTML. Expected MT4 DetailedStatement.htm or MT5 HTML report (Deals table).'
    );
    err.code = 'STATEMENT_PARSE_ACCOUNT';
    throw err;
  }

  const accountKey = resolveImportAccountKey(parsed.login, opts.targetAccountKey, opts.knownAccounts, flavor);
  const rows = statementRowsToTrades(parsed.trades, accountKey, {
    login: parsed.login,
    displayName: parsed.displayName,
    statementPath: filePath,
    sourceTag
  });
  return {
    accountKey,
    login: parsed.login,
    displayName: parsed.displayName,
    trades: rows,
    skippedRows: parsed.skippedRows,
    parsedRowCount: parsed.trades.length,
    flavor
  };
}

module.exports = {
  parseMt4DetailedStatementHtml,
  parseMt5ReportDealsHtml,
  parseMtAmount,
  resolveImportAccountKey,
  mergeStatementImports,
  parseDetailedStatementFromFile
};
