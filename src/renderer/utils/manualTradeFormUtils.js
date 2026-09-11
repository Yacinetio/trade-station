export function triBandValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'yes' || v === 'no' || v === 'na' || v === 'n/a') return v === 'n/a' ? 'na' : v;
  return '';
}

/** OB STATS trend alignment: WITH / AGAINST / NEUTRAL / n/a */
export function trendAlignValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'with' || v === 'against' || v === 'neutral') return v;
  if (v === 'na' || v === 'n/a') return 'na';
  return '';
}

export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export const EMPTY_MANUAL_DRAFT = {
  symbol: '',
  type: 'BUY',
  entry: '',
  signalEntry: '',
  sl: '',
  tp: '',
  lot: '',
  timeframe: '',
  bias: '',
  vwapBand: '',
  hvnBand: '',
  trendAlign: '',
  obSize: '',
  avgEntry: '',
  obEdge: '',
  openedAt: '',
  closedAt: '',
  comment: ''
};

export function fieldsToDraft(fields) {
  if (!fields) return { ...EMPTY_MANUAL_DRAFT };
  return {
    symbol: fields.symbol || '',
    type: fields.type || 'BUY',
    entry: fields.entry != null ? String(fields.entry) : '',
    signalEntry: fields.signalEntry != null ? String(fields.signalEntry) : '',
    sl: fields.sl != null ? String(fields.sl) : '',
    tp: fields.tp != null ? String(fields.tp) : '',
    lot: fields.lot != null ? String(fields.lot) : '',
    timeframe: fields.timeframe || '',
    bias: fields.bias || '',
    vwapBand: triBandValue(fields.vwapBand),
    hvnBand: triBandValue(fields.hvnBand),
    trendAlign: trendAlignValue(fields.trendAlign),
    obSize: fields.obSize != null ? String(fields.obSize) : '',
    avgEntry: fields.avgEntry != null ? String(fields.avgEntry) : '',
    obEdge: fields.obEdge != null ? String(fields.obEdge) : '',
    openedAt: isoToLocalInput(fields.openedAt),
    closedAt: isoToLocalInput(fields.closedAt || fields.openedAt),
    comment: fields.comment || ''
  };
}

export function draftToFields(draft) {
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  };
  return {
    symbol: String(draft.symbol || '').trim().toUpperCase(),
    type: String(draft.type || 'BUY').toUpperCase(),
    entry: num(draft.entry),
    signalEntry: num(draft.signalEntry) ?? num(draft.entry),
    sl: num(draft.sl),
    tp: num(draft.tp),
    lot: num(draft.lot),
    timeframe: String(draft.timeframe || '').trim(),
    bias: String(draft.bias || '').trim(),
    vwapBand: String(draft.vwapBand || '').trim(),
    hvnBand: String(draft.hvnBand || '').trim(),
    trendAlign: String(draft.trendAlign || '').trim(),
    obSize: String(draft.obSize || '').trim(),
    avgEntry: num(draft.avgEntry),
    obEdge: num(draft.obEdge),
    openedAt: localInputToIso(draft.openedAt) || new Date().toISOString(),
    closedAt: localInputToIso(draft.closedAt) || localInputToIso(draft.openedAt) || new Date().toISOString(),
    comment: String(draft.comment || '').trim()
  };
}

/** Apply parseManualTelegram fields onto trade-detail editor setters. */
export function applyParsedFieldsToTradeEditors(fields, setters = {}) {
  if (!fields) return;
  const str = (v) => (v != null && v !== '' ? String(v) : null);

  if (str(fields.symbol)) setters.setSymbol?.(String(fields.symbol).toUpperCase());
  if (str(fields.type)) setters.setType?.(String(fields.type).toUpperCase());
  if (str(fields.entry)) setters.setEntry?.(String(fields.entry));
  if (str(fields.signalEntry)) setters.setSignalEntry?.(String(fields.signalEntry));
  else if (str(fields.entry)) setters.setSignalEntry?.(String(fields.entry));
  if (str(fields.sl)) setters.setSl?.(String(fields.sl));
  if (str(fields.tp)) setters.setTp?.(String(fields.tp));
  if (str(fields.lot)) setters.setLot?.(String(fields.lot));
  if (str(fields.timeframe)) setters.setTimeframe?.(String(fields.timeframe));
  if (str(fields.bias)) setters.setBias?.(String(fields.bias));
  if (fields.vwapBand != null && fields.vwapBand !== '') setters.setVwapBand?.(triBandValue(fields.vwapBand));
  if (fields.hvnBand != null && fields.hvnBand !== '') setters.setHvnBand?.(triBandValue(fields.hvnBand));
  if (fields.trendAlign != null && fields.trendAlign !== '') setters.setTrendAlign?.(trendAlignValue(fields.trendAlign));
  if (str(fields.obSize)) setters.setObSize?.(String(fields.obSize));
  if (str(fields.avgEntry)) setters.setAvgEntry?.(String(fields.avgEntry));
  if (str(fields.obEdge)) setters.setObEdge?.(String(fields.obEdge));
}
