import React from 'react';

const EMOTIONS = [
  { id: 'calm', label: '😌 Calm' },
  { id: 'confident', label: '💪 Confident' },
  { id: 'fomo', label: '🏃 FOMO' },
  { id: 'revenge', label: '😤 Revenge' },
  { id: 'anxious', label: '😰 Anxious' },
  { id: 'tired', label: '🥱 Tired' },
  { id: 'distracted', label: '📱 Distracted' }
];

const RATINGS = ['A', 'B', 'C', 'D', 'E', 'F'];

const RATING_COLORS = {
  A: 'var(--success, #4caf7d)',
  B: 'var(--success, #4caf7d)',
  C: 'var(--warning, #e0a93e)',
  D: 'var(--warning, #e0a93e)',
  E: 'var(--danger, #ff5c75)',
  F: 'var(--danger, #ff5c75)'
};

/**
 * Psychology journaling controls for the trade detail modal:
 * an emotion picker (single choice, click again to clear) and an A–F
 * self-rating of trade execution quality.
 */
export default function PsychologyFields({ emotion = '', rating = '', onEmotionChange, onRatingChange }) {
  return (
    <div className="form-group trade-detail-span-full" style={{ marginBottom: 0 }}>
      <label>Psychology</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {EMOTIONS.map((e) => {
          const on = String(emotion).toLowerCase() === e.id;
          return (
            <button
              key={e.id}
              type="button"
              className={on ? 'btn btn-primary' : 'btn btn-outline'}
              style={{ fontSize: 11, padding: '4px 10px' }}
              title={on ? 'Click to clear' : `Mark emotional state: ${e.id}`}
              onClick={() => onEmotionChange?.(on ? '' : e.id)}
            >
              {e.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>Execution grade</span>
        {RATINGS.map((r) => {
          const on = String(rating).toUpperCase() === r;
          return (
            <button
              key={r}
              type="button"
              className={on ? 'btn btn-primary' : 'btn btn-outline'}
              style={{
                fontSize: 12,
                fontWeight: 700,
                width: 32,
                padding: '4px 0',
                textAlign: 'center',
                ...(on ? {} : { color: RATING_COLORS[r] })
              }}
              title={on ? 'Click to clear' : `Grade this trade ${r}`}
              onClick={() => onRatingChange?.(on ? '' : r)}
            >
              {r}
            </button>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        How you felt and how well you executed — independent of the P&L outcome.
      </div>
    </div>
  );
}
