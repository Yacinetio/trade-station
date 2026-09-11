import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown, renderInline } from '../src/renderer/utils/miniMarkdown.js';

function toHtml(markdown) {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, renderMarkdown(markdown)));
}

describe('miniMarkdown', () => {
  it('renders headings h1–h6', () => {
    expect(toHtml('# Title')).toContain('<h1>Title</h1>');
    expect(toHtml('## Sub')).toContain('<h2>Sub</h2>');
    expect(toHtml('###### Deep')).toContain('<h6>Deep</h6>');
  });

  it('renders bold, italic and inline code', () => {
    const html = toHtml('This is **bold**, *ital* and `code`.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>ital</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders unordered and ordered lists', () => {
    const ul = toHtml('- one\n- two');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>one</li>');
    expect(ul).toContain('<li>two</li>');

    const ol = toHtml('1. first\n2. second');
    expect(ol).toContain('<ol>');
    expect(ol).toContain('<li>first</li>');
  });

  it('renders checkbox task items', () => {
    const html = toHtml('- [ ] open task\n- [x] done task');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('open task');
    expect(html).toContain('done task');
  });

  it('renders basic pipe tables', () => {
    const html = toHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders fenced code blocks verbatim', () => {
    const html = toHtml('```\nconst x = 1;\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('const x = 1;');
  });

  it('renders blockquotes and horizontal rules', () => {
    expect(toHtml('> quoted line')).toContain('<blockquote>');
    expect(toHtml('---')).toContain('<hr');
  });

  it('escapes HTML — no raw script/tag passthrough', () => {
    const html = toHtml('<script>alert("xss")</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML inside emphasis and code spans', () => {
    const html = toHtml('**<b>bold</b>** and `<i>tag</i>`');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('renderInline returns plain text untouched', () => {
    const html = renderToStaticMarkup(React.createElement('span', null, renderInline('just text')));
    expect(html).toBe('<span>just text</span>');
  });
});
