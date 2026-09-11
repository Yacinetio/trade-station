import React from 'react';
import { StatMetric, ProgressBar, Badge, Tooltip, Card, CardBody } from '../ui';

/**
 * Exemple : Enhanced Stats Dashboard
 * Montre comment utiliser les nouveaux composants UI
 */
export default function EnhancedStatsExample() {
  return (
    <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
      {/* StatMetric Examples */}
      <Card hoverable className="stat-card">
        <CardBody>
          <StatMetric
            icon="📊"
            label="Win Rate"
            value="62.5%"
            color="success"
            trend="up"
            trendValue={3.2}
            description="Last 7 days"
            animated
          />
        </CardBody>
      </Card>

      <Card hoverable className="stat-card">
        <CardBody>
          <StatMetric
            icon="💰"
            label="Total P&L"
            value="+$2,450.00"
            color="accent"
            trend="up"
            trendValue={5.8}
            description="This month"
            animated
          />
        </CardBody>
      </Card>

      <Card hoverable className="stat-card">
        <CardBody>
          <StatMetric
            icon="🎯"
            label="Avg R:R"
            value="1:2.3"
            color="warning"
            trend="stable"
            description="Risk/Reward ratio"
            animated
          />
        </CardBody>
      </Card>

      <Card hoverable className="stat-card">
        <CardBody>
          <StatMetric
            icon="📈"
            label="Trades"
            value="24"
            color="neutral"
            description="Closed this month"
            animated
          />
        </CardBody>
      </Card>

      {/* ProgressBar Examples */}
      <div style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
        <h3 style={{ marginBottom: '16px' }}>Performance by Pair</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
          <ProgressBar
            label="EURUSD"
            value={75}
            color="success"
            animated
            size="md"
            showValue
            rightContent="18 trades"
          />
          <ProgressBar
            label="GBPUSD"
            value={42}
            color="warning"
            animated
            size="md"
            showValue
            rightContent="12 trades"
          />
          <ProgressBar
            label="USDJPY"
            value={65}
            color="accent"
            animated
            size="md"
            showValue
            rightContent="15 trades"
          />
          <ProgressBar
            label="AUDUSD"
            value={38}
            color="danger"
            animated
            size="md"
            showValue
            rightContent="8 trades"
          />
        </div>
      </div>

      {/* Badge Examples */}
      <div style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
        <h3 style={{ marginBottom: '16px' }}>Status Indicators</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Badge variant="success" icon="✓" pill>Connected</Badge>
          <Badge variant="danger" icon="×" pill>2 Errors</Badge>
          <Badge variant="info" icon="ℹ" pill>3 Signals</Badge>
          <Badge variant="warning" icon="!" pill>Low Balance</Badge>
          <Badge variant="default" pill>Idle</Badge>
        </div>
      </div>

      {/* Tooltip Examples */}
      <div style={{ gridColumn: '1 / -1', marginTop: '20px' }}>
        <h3 style={{ marginBottom: '16px' }}>Hover for Info</h3>
        <div style={{ display: 'flex', gap: '16px' }}>
          <Tooltip content="Win rate calculated from closed trades" position="top">
            <span style={{ cursor: 'help', fontSize: '14px' }}>
              📊 Win Rate: 62.5%
            </span>
          </Tooltip>
          <Tooltip content="Risk to Reward ratio for this trade" position="top">
            <span style={{ cursor: 'help', fontSize: '14px' }}>
              🎯 R:R Ratio: 1:2.3
            </span>
          </Tooltip>
          <Tooltip content="Pending order waiting for market" position="top">
            <span style={{ cursor: 'help', fontSize: '14px' }}>
              ⏳ Pending: 3 orders
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

