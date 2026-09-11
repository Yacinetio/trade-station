import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSavedFilterPresets } from '../hooks/useSavedFilterPresets.js';
import {
  findMatchingPreset,
  findMatchingPresetMerge,
  mergeFilterPresets,
  loadAppliedTemplateIds,
  persistAppliedTemplateIds
} from '../utils/filterPresetMatch.js';

function formatMoney(value) {
  const n = Number(value || 0);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

export default function FilterTemplatesControl({
  tradeFilters = {},
  setTradeFilters = () => {},
  timeScope = null,
  setTimeScope = null,
  analyticsCustomRange = null,
  setAnalyticsCustomRange = null,
  results = null,
  filterSummary = '',
  testIdPrefix = 'filter-templates'
}) {
  const { presets, savePreset, updatePreset, deletePreset } = useSavedFilterPresets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [checkedIds, setCheckedIds] = useState([]);
  const [appliedIds, setAppliedIds] = useState(() => loadAppliedTemplateIds());
  const [mergeMessage, setMergeMessage] = useState('');
  const wrapRef = useRef(null);

  const matchedPreset = useMemo(
    () => findMatchingPreset(presets, tradeFilters),
    [presets, tradeFilters]
  );

  const matchedMerge = useMemo(
    () => findMatchingPresetMerge(presets, tradeFilters, appliedIds),
    [presets, tradeFilters, appliedIds]
  );

  const checkedPresets = useMemo(
    () => checkedIds.map((id) => presets.find((p) => p.id === id)).filter(Boolean),
    [checkedIds, presets]
  );

  const mergePreview = useMemo(
    () => (checkedPresets.length ? mergeFilterPresets(checkedPresets) : null),
    [checkedPresets]
  );

  const activeSingle = useMemo(() => {
    if (matchedMerge) return null;
    if (matchedPreset) return matchedPreset;
    if (appliedIds.length === 1) return presets.find((p) => p.id === appliedIds[0]) || null;
    return null;
  }, [matchedMerge, matchedPreset, appliedIds, presets]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!appliedIds.length) return;
    const merge = appliedIds.length >= 2
      ? findMatchingPresetMerge(presets, tradeFilters, appliedIds)
      : null;
    const single = appliedIds.length === 1
      ? findMatchingPreset(presets, tradeFilters)
      : null;
    if (merge) return;
    if (single && appliedIds[0] === single.id) return;
    setAppliedIds([]);
    persistAppliedTemplateIds([]);
  }, [tradeFilters, presets, appliedIds]);

  useEffect(() => {
    if (activeSingle?.name) setName(activeSingle.name);
  }, [activeSingle?.id, activeSingle?.name]);

  useEffect(() => {
    if (!open) return;
    if (appliedIds.length) {
      setCheckedIds([...appliedIds]);
    } else if (activeSingle?.id) {
      setCheckedIds([activeSingle.id]);
    }
  }, [open]);

  const toggleChecked = useCallback((id) => {
    setCheckedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
    setMergeMessage('');
  }, []);

  const applyMerge = useCallback((mergeResult) => {
    if (!mergeResult?.ok || !mergeResult.filters) return false;
    setTradeFilters({ ...mergeResult.filters });
    if (setTimeScope && mergeResult.timeScope) {
      setTimeScope(mergeResult.timeScope);
      if (
        mergeResult.timeScope === 'CUSTOM'
        && setAnalyticsCustomRange
        && mergeResult.scopeFrom
        && mergeResult.scopeTo
      ) {
        setAnalyticsCustomRange({ from: mergeResult.scopeFrom, to: mergeResult.scopeTo });
      }
    }
    const ids = mergeResult.presetIds || [];
    setAppliedIds(ids);
    persistAppliedTemplateIds(ids);
    setMergeMessage(mergeResult.summary || '');
    setOpen(false);
    return true;
  }, [setTradeFilters, setTimeScope, setAnalyticsCustomRange]);

  const handleApplySelected = useCallback(() => {
    if (!checkedPresets.length) return;
    const merged = mergeFilterPresets(checkedPresets);
    if (!merged.ok) {
      setMergeMessage(merged.summary || merged.error || 'Cannot combine these templates.');
      return;
    }
    applyMerge(merged);
  }, [checkedPresets, applyMerge]);

  const buildEntry = useCallback((templateName) => ({
    name: templateName,
    timeScope: timeScope || 'ALL',
    scopeFrom: analyticsCustomRange?.from || '',
    scopeTo: analyticsCustomRange?.to || '',
    filters: { ...tradeFilters },
    results: results || {},
    filterSummary
  }), [timeScope, analyticsCustomRange, tradeFilters, results, filterSummary]);

  const handleSaveNew = useCallback(() => {
    const templateName = name.trim();
    if (!templateName) return;
    const row = savePreset(buildEntry(templateName));
    if (row?.id) {
      setAppliedIds([row.id]);
      setCheckedIds([row.id]);
    }
    setOpen(false);
  }, [name, savePreset, buildEntry]);

  const handleUpdate = useCallback(() => {
    const id = activeSingle?.id || (checkedIds.length === 1 ? checkedIds[0] : '');
    if (!id) return;
    const templateName = name.trim() || activeSingle?.name;
    if (!templateName) return;
    updatePreset(id, buildEntry(templateName));
    setAppliedIds([id]);
    setCheckedIds([id]);
    setOpen(false);
  }, [activeSingle, checkedIds, name, updatePreset, buildEntry]);

  const handleDelete = useCallback(() => {
    const id = activeSingle?.id || (checkedIds.length === 1 ? checkedIds[0] : '');
    if (!id) return;
    deletePreset(id);
    setAppliedIds((prev) => prev.filter((x) => x !== id));
    setCheckedIds((prev) => prev.filter((x) => x !== id));
    setName('');
  }, [activeSingle, checkedIds, deletePreset]);

  const triggerLabel = useMemo(() => {
    if (matchedMerge?.presetNames?.length) {
      const label = matchedMerge.presetNames.join(' + ');
      return label.length > 28 ? `${label.slice(0, 25)}… (${matchedMerge.presetNames.length})` : `${label} (${matchedMerge.presetNames.length})`;
    }
    if (activeSingle?.name) return activeSingle.name;
    if (presets.length) return 'Templates';
    return 'Save filters';
  }, [matchedMerge, activeSingle, presets.length]);

  const isActive = !!(matchedMerge || activeSingle);
  const canUpdateDelete = !!(activeSingle || checkedIds.length === 1);
  const previewText = mergePreview?.ok
    ? mergePreview.summary
    : (mergePreview?.summary || mergeMessage);
  const previewIsError = mergePreview ? !mergePreview.ok : Boolean(mergeMessage);

  return (
    <div className="filter-templates" ref={wrapRef} data-testid={testIdPrefix}>
      <button
        type="button"
        className={`filter-templates-trigger ${isActive ? 'is-active' : ''}`}
        data-testid={`${testIdPrefix}-trigger`}
        onClick={() => setOpen((v) => !v)}
        title="Saved filter templates — select one or combine several (e.g. Mon–Thu + Fri)"
      >
        <span className="filter-templates-label">Templates</span>
        <span className="filter-templates-value">{triggerLabel}</span>
        {presets.length > 0 && <span className="filter-templates-badge">{presets.length}</span>}
      </button>

      {open && (
        <div className="filter-templates-menu" data-testid={`${testIdPrefix}-menu`}>
          <div className="filter-templates-menu-title">Filter templates</div>
          <div className="filter-templates-hint">
            Tick several templates to combine slice filters (e.g. Mon–Thu + Fri). Tab, type, status, and scope must match.
          </div>

          {presets.length === 0 ? (
            <div className="filter-templates-empty">No saved templates yet.</div>
          ) : (
            <div className="filter-templates-list">
              {presets.map((p) => {
                const checked = checkedIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`filter-templates-item ${checked ? 'is-selected' : ''}`}
                    data-testid={`${testIdPrefix}-item-${p.id}`}
                  >
                    <input
                      type="checkbox"
                      className="filter-templates-check"
                      checked={checked}
                      onChange={() => toggleChecked(p.id)}
                    />
                    <span className="filter-templates-item-body">
                      <span className="filter-templates-item-name">{p.name}</span>
                      <span className="filter-templates-item-meta">
                        {p.results?.tradeCount != null ? `${p.results.tradeCount} trades` : '—'}
                        {p.results?.winRate != null ? ` · ${p.results.winRate}% WR` : ''}
                        {p.results?.pnl != null ? ` · ${formatMoney(p.results.pnl)}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {checkedPresets.length > 0 && previewText && (
            <div className={`filter-templates-preview ${previewIsError ? 'is-error' : 'is-ok'}`}>
              {previewText}
            </div>
          )}

          {checkedPresets.length > 0 && (
            <div className="filter-templates-apply-row">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!mergePreview?.ok}
                onClick={handleApplySelected}
                data-testid={`${testIdPrefix}-apply-selected`}
              >
                {checkedPresets.length === 1
                  ? 'Apply template'
                  : `Apply ${checkedPresets.length} combined`}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => { setCheckedIds([]); setMergeMessage(''); }}
              >
                Clear selection
              </button>
            </div>
          )}

          <div className="filter-templates-editor">
            <input
              className="filter-templates-name"
              placeholder="Template name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNew();
              }}
              data-testid={`${testIdPrefix}-name`}
            />
            <div className="filter-templates-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!name.trim()}
                onClick={handleSaveNew}
                data-testid={`${testIdPrefix}-save`}
              >
                Save new
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!canUpdateDelete}
                onClick={handleUpdate}
                data-testid={`${testIdPrefix}-update`}
                title="Overwrite selected template with current filters"
              >
                Update
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={!canUpdateDelete}
                onClick={handleDelete}
                data-testid={`${testIdPrefix}-delete`}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
