/**
 * Tiny, safe markdown renderer for the Notebook preview.
 *
 * Supports: #–###### headings, **bold**, *italic* / _italic_, `inline code`,
 * fenced code blocks, unordered/ordered lists (incl. - [ ] checkboxes),
 * basic pipe tables, > blockquotes, --- rules, paragraphs.
 *
 * Safety: output is built exclusively with React.createElement — raw text
 * always flows through React children, so HTML in the source is escaped by
 * React itself. No dangerouslySetInnerHTML anywhere. Plain createElement
 * calls (no JSX) so the module also loads in node-environment unit tests.
 */

import React from 'react';

const h = React.createElement;

const INLINE_TOKEN_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;

/** Parse inline markdown of a single line into an array of React nodes. */
export function renderInline(text, keyPrefix = 'in') {
  const parts = String(text ?? '').split(INLINE_TOKEN_RE);
  const out = [];
  parts.forEach((part, i) => {
    if (!part) return;
    const key = `${keyPrefix}-${i}`;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      out.push(h('code', { key }, part.slice(1, -1)));
    } else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      out.push(h('strong', { key }, renderInline(part.slice(2, -2), key)));
    } else if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      out.push(h('em', { key }, renderInline(part.slice(1, -1), key)));
    } else if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) {
      out.push(h('em', { key }, renderInline(part.slice(1, -1), key)));
    } else {
      out.push(h(React.Fragment, { key }, part));
    }
  });
  return out;
}

function isTableRow(line) {
  const t = String(line || '').trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 1;
}

function isTableSeparator(line) {
  const t = String(line || '').trim();
  if (!isTableRow(t)) return false;
  return t
    .slice(1, -1)
    .split('|')
    .every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell));
}

function splitTableCells(line) {
  return String(line || '').trim().slice(1, -1).split('|').map((c) => c.trim());
}

const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;

/** Render a markdown string into an array of React block elements. */
export function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  const nextKey = (name) => `md-${name}-${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push(h('pre', { key: nextKey('pre'), className: 'mini-md-pre' }, h('code', null, buf.join('\n'))));
      continue;
    }

    // Heading
    const hMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push(h(`h${level}`, { key: nextKey('h') }, renderInline(hMatch[2], nextKey('hin'))));
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(h('hr', { key: nextKey('hr') }));
      i += 1;
      continue;
    }

    // Blockquote (consecutive > lines)
    if (trimmed.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        h(
          'blockquote',
          { key: nextKey('bq') },
          buf.map((l, j) => h('p', { key: j }, renderInline(l, nextKey('bqin'))))
        )
      );
      continue;
    }

    // Table (header row + separator row)
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableCells(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableCells(lines[i]));
        i += 1;
      }
      blocks.push(
        h(
          'table',
          { key: nextKey('tbl'), className: 'mini-md-table' },
          h('thead', null, h('tr', null, header.map((cell, j) => h('th', { key: j }, renderInline(cell, nextKey('th')))))),
          h(
            'tbody',
            null,
            rows.map((cells, r) =>
              h('tr', { key: r }, header.map((_, c) => h('td', { key: c }, renderInline(cells[c] ?? '', nextKey('td')))))
            )
          )
        )
      );
      continue;
    }

    // Lists (unordered or ordered, consecutive items)
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const re = ordered ? OL_RE : UL_RE;
      const items = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].match(re)[1]);
        i += 1;
      }
      blocks.push(
        h(
          ordered ? 'ol' : 'ul',
          { key: nextKey('list') },
          items.map((item, j) => {
            const check = item.match(/^\[( |x|X)\]\s*(.*)$/);
            if (check) {
              return h(
                'li',
                { key: j, className: 'mini-md-task' },
                h('input', { type: 'checkbox', checked: check[1].toLowerCase() === 'x', readOnly: true }),
                ' ',
                renderInline(check[2], nextKey('liin'))
              );
            }
            return h('li', { key: j }, renderInline(item, nextKey('liin')));
          })
        )
      );
      continue;
    }

    // Paragraph: accumulate until a blank line or another block start
    const buf = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('```') &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !isTableRow(lines[i].trim())
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      h(
        'p',
        { key: nextKey('p') },
        buf.map((l, j) => h(React.Fragment, { key: j }, j > 0 ? h('br') : null, renderInline(l, nextKey('pin'))))
      )
    );
  }

  return blocks;
}
