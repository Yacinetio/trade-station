import React, { useState } from 'react';
import { CalendarDaySelector } from '../components/ui';

/**
 * CalendarDaySelector Demo
 * Shows how to use the calendar component with day selection and modal
 */

export default function CalendarDaySelectorDemo() {
  // Sample trades data (would come from store in real app)
  const [trades] = useState([
    {
      id: '1',
      symbol: 'EURUSD',
      type: 'BUY',
      status: 'CLOSED_TP',
      profit: 125.5,
      openedAt: new Date(2026, 3, 20, 9, 30).toISOString(),
    },
    {
      id: '2',
      symbol: 'GBPUSD',
      type: 'SELL',
      status: 'CLOSED_SL',
      profit: -87.25,
      openedAt: new Date(2026, 3, 20, 14, 15).toISOString(),
    },
    {
      id: '3',
      symbol: 'USDJPY',
      type: 'BUY',
      status: 'CLOSED_TP',
      profit: 250.0,
      openedAt: new Date(2026, 3, 20, 16, 45).toISOString(),
    },
    {
      id: '4',
      symbol: 'AUDUSD',
      type: 'SELL',
      status: 'CLOSED_TP',
      profit: 175.75,
      openedAt: new Date(2026, 3, 21, 10, 20).toISOString(),
    },
    {
      id: '5',
      symbol: 'NZDUSD',
      type: 'BUY',
      status: 'CLOSED_SL',
      profit: -45.5,
      openedAt: new Date(2026, 3, 21, 15, 30).toISOString(),
    },
    {
      id: '6',
      symbol: 'EURUSD',
      type: 'BUY',
      status: 'CLOSED_TP',
      profit: 320.0,
      openedAt: new Date(2026, 3, 22, 11, 0).toISOString(),
    },
    {
      id: '7',
      symbol: 'GBPJPY',
      type: 'SELL',
      status: 'CLOSED_TP',
      profit: 210.25,
      openedAt: new Date(2026, 3, 23, 13, 45).toISOString(),
    },
    {
      id: '8',
      symbol: 'CHFUSD',
      type: 'BUY',
      status: 'CLOSED_TP',
      profit: 95.5,
      openedAt: new Date(2026, 3, 24, 9, 15).toISOString(),
    },
  ]);

  const [selectedDay, setSelectedDay] = useState(null);

  const handleDaySelected = (date) => {
    console.log('Day selected:', date);
    setSelectedDay(date);
  };

  return (
    <div
      style={{
        padding: '20px',
        maxWidth: '900px',
        margin: '0 auto',
      }}
    >
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
          📅 Calendar Day Selector Demo
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text2)' }}>
          Click on any day to see trades for that day. The calendar shows daily P&L and trade count.
        </p>
      </div>

      {selectedDay && (
        <div
          style={{
            marginBottom: '20px',
            padding: '16px',
            background: 'rgba(61, 217, 255, 0.1)',
            border: '1px solid rgba(61, 217, 255, 0.3)',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        >
          <strong style={{ color: 'var(--accent)' }}>Selected Day:</strong>{' '}
          {selectedDay.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      )}

      <CalendarDaySelector
        trades={trades}
        onDaySelected={handleDaySelected}
        currentDate={new Date(2026, 3, 23)}
      />

      <div
        style={{
          marginTop: '40px',
          padding: '20px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
        }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>
          📋 Features
        </h3>
        <ul style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: '1.8', paddingLeft: '20px' }}>
          <li>✓ Interactive calendar with month navigation</li>
          <li>✓ Display daily P&L (color-coded: green for profit, red for loss)</li>
          <li>✓ Show trade count for each day</li>
          <li>✓ Click day to open modal with detailed trades</li>
          <li>✓ Modal shows day statistics and individual trades</li>
          <li>✓ Fully styled with CSS variables (matches app theme)</li>
          <li>✓ Responsive and performant</li>
          <li>✓ No external dependencies except lucide-react for icons</li>
        </ul>
      </div>
    </div>
  );
}

