import React, { useMemo, useState } from 'react';

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function serializeChecklist(items = []) {
  return items
    .map((item) => `[${item.done ? 'x' : ' '}] ${item.label}`)
    .join('\n');
}

function parseChecklist(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\[(x| )\]\s*(.+)$/i);
      if (!match) {
        return { id: `${Date.now()}-${Math.random()}`, label: line, done: false };
      }
      return {
        id: `${Date.now()}-${Math.random()}`,
        label: match[2].trim(),
        done: match[1].toLowerCase() === 'x'
      };
    });
}

export default function TradeJournalModal({ trade, onClose, onSave, saving = false }) {
  const journal = trade?.journal || {};
  const [notes, setNotes] = useState(journal.notes || '');
  const [tags, setTags] = useState((journal.tags || []).join(', '));
  const [mistakes, setMistakes] = useState((journal.mistakes || []).join(', '));
  const [checklist, setChecklist] = useState(serializeChecklist(journal.checklist || []));
  const [confidence, setConfidence] = useState(Number.isFinite(Number(journal.confidence)) ? Number(journal.confidence) : 5);

  const payload = useMemo(() => ({
    notes: notes.trim(),
    tags: parseList(tags),
    mistakes: parseList(mistakes),
    checklist: parseChecklist(checklist),
    confidence: Number(confidence)
  }), [notes, tags, mistakes, checklist, confidence]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal trade-journal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trade Journal - {trade?.symbol} {trade?.type}</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="modal-body trade-journal-body">
          <div className="form-group">
            <label>Notes</label>
            <textarea
              className="journal-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Narrative, context, and post-trade notes..."
            />
          </div>
          <div className="form-group">
            <label>Tags (comma separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="breakout, london open, pullback" />
          </div>
          <div className="form-group">
            <label>Mistakes (comma separated)</label>
            <input value={mistakes} onChange={(e) => setMistakes(e.target.value)} placeholder="late entry, moved stop, overtraded" />
          </div>
          <div className="form-group">
            <label>Checklist (one per line, optional [x] prefix)</label>
            <textarea
              className="journal-textarea"
              value={checklist}
              onChange={(e) => setChecklist(e.target.value)}
              placeholder="[x] Followed setup rules"
            />
          </div>
          <div className="form-group">
            <label>Confidence ({confidence}/10)</label>
            <input type="range" min="0" max="10" step="1" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(payload)}>
            {saving ? 'Saving...' : 'Save Journal'}
          </button>
        </div>
      </div>
    </div>
  );
}
