/**
 * Dashboard overview layout: assign rows, then columns from halfSide preference.
 * Half tiles pair into rows (max 2); Left/Right always maps to the chosen column.
 *
 * @param {string[]} order
 * @param {Record<string, boolean>} wide layout.wide (false ⇒ half tile)
 * @param {Record<string, 'left'|'right'>} halfSide
 */
export function computeOverviewGridPlacement(order, wide, halfSide) {
  const out = {};
  /** @type {Map<number, string[]>} */
  const rowHalves = new Map();
  /** @type {Set<number>} */
  const fullRows = new Set();
  let nextRow = 1;

  const sideToCol = (id) => (halfSide?.[id] === 'right' ? 1 : 0);

  const findJoinableHalfRow = () => {
    for (const row of [...rowHalves.keys()].sort((a, b) => a - b)) {
      if (fullRows.has(row)) continue;
      const ids = rowHalves.get(row) || [];
      if (ids.length < 2) return row;
    }
    return null;
  };

  for (const id of order) {
    const isFull = wide?.[id] !== false;
    if (isFull) {
      const row = nextRow++;
      fullRows.add(row);
      out[id] = { gridColumn: '1 / -1', gridRow: String(row) };
      continue;
    }

    let row = findJoinableHalfRow();
    if (row == null) {
      row = nextRow++;
      rowHalves.set(row, []);
    }
    rowHalves.get(row).push(id);
  }

  for (const [row, ids] of rowHalves) {
    if (fullRows.has(row) || ids.length === 0) continue;

    if (ids.length === 1) {
      const id = ids[0];
      const col = sideToCol(id);
      out[id] = {
        gridColumn: col === 0 ? '1 / 2' : '2 / 3',
        gridRow: String(row)
      };
      continue;
    }

    const [a, b] = ids.slice(0, 2);
    const prefA = sideToCol(a);
    const prefB = sideToCol(b);
    let colA;
    let colB;
    if (prefA !== prefB) {
      colA = prefA;
      colB = prefB;
    } else {
      colA = prefA;
      colB = 1 - prefA;
    }
    out[a] = {
      gridColumn: colA === 0 ? '1 / 2' : '2 / 3',
      gridRow: String(row)
    };
    out[b] = {
      gridColumn: colB === 0 ? '1 / 2' : '2 / 3',
      gridRow: String(row)
    };

    for (let i = 2; i < ids.length; i++) {
      const spill = ids[i];
      const spillRow = nextRow++;
      rowHalves.set(spillRow, [spill]);
      const col = sideToCol(spill);
      out[spill] = {
        gridColumn: col === 0 ? '1 / 2' : '2 / 3',
        gridRow: String(spillRow)
      };
    }
  }

  return out;
}

/**
 * Group placed tiles into render rows (full-width or left/right pair).
 * @returns {{ row: number, fullId: string|null, leftId: string|null, rightId: string|null }[]}
 */
export function buildOverviewRowGroups(order, wide, halfSide) {
  const placement = computeOverviewGridPlacement(order, wide, halfSide);
  const rowNums = new Set();
  for (const id of order) {
    const row = Number(placement[id]?.gridRow);
    if (Number.isFinite(row)) rowNums.add(row);
  }

  const groups = [];
  for (const row of [...rowNums].sort((a, b) => a - b)) {
    const idsOnRow = order.filter((id) => Number(placement[id]?.gridRow) === row);
    const fullId = idsOnRow.find((id) => placement[id]?.gridColumn === '1 / -1') || null;
    const leftId = idsOnRow.find((id) => placement[id]?.gridColumn === '1 / 2') || null;
    const rightId = idsOnRow.find((id) => placement[id]?.gridColumn === '2 / 3') || null;
    groups.push({ row, fullId, leftId, rightId });
  }
  return groups;
}
