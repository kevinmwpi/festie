#!/usr/bin/env node
/**
 * Builds the public legal/support pages from their Markdown sources so the App Store URLs, the
 * in-app screens and the repository copy can never drift apart.
 *
 *   node docs/legal/generate.mjs            write every output
 *   node docs/legal/generate.mjs --check    exit 1 if any output is out of date (CI)
 *   node docs/legal/generate.mjs --release  exit 1 if any __PLACEHOLDER__ token is left or the support
 *                                           email is not set (pre-submission); writes nothing
 *
 * Sources (edit these):  docs/legal/privacy-policy.md, docs/legal/terms-of-use.md, docs/legal/support.md,
 *                        docs/legal/values.json (template values)
 * Outputs (never edit):  docs/site/{index,privacy,terms,support}.html,
 *                        docs/site/favicon.png and docs/site/apple-touch-icon.png (copied byte for byte
 *                        from apps/mobile/assets/images/favicon.png and icon.png),
 *                        apps/mobile/app/legal/{privacy-policy,terms-of-use}.tsx
 *
 * The visual rules for both outputs are in docs/design-system.md ("Website"; the in-app screens use the
 * `textStyles` roles). `--check` ignores CRLF line endings in the HTML/TSX on disk (Windows checkouts with
 * core.autocrlf) and compares the copied images byte for byte.
 *
 * The Markdown is a deliberately small subset so it renders identically everywhere:
 *   `# Title` (first line), a `Last updated: …` line, `## Heading`, `### Subheading`, paragraphs,
 *   `- bullet` items (continuation lines indented by two spaces), `**bold**`, `[text](href)` and
 *   `<!-- comments -->` (dropped). Links to the sibling .md files become in-app routes / .html pages.
 *
 * `__SUPPORT_EMAIL__` is a template variable, not a placeholder: it stays in the Markdown. The web pages
 * get `supportEmail` from docs/legal/values.json as a mailto: link; the in-app screens show the
 * build's EXPO_PUBLIC_SUPPORT_EMAIL as a tappable link (falling back to `supportEmail`). `--release`
 * fails if `supportEmail` is empty, or differs from EXPO_PUBLIC_SUPPORT_EMAIL when that is set.
 * No dependencies: plain Node >= 20.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => path.join(ROOT, p);

/** Each document: Markdown source, static page, optional in-app screen. */
const DOCUMENTS = [
  {
    key: 'privacy',
    source: 'docs/legal/privacy-policy.md',
    html: 'docs/site/privacy.html',
    screen: 'apps/mobile/app/legal/privacy-policy.tsx',
    component: 'PrivacyPolicyScreen',
  },
  {
    key: 'terms',
    source: 'docs/legal/terms-of-use.md',
    html: 'docs/site/terms.html',
    screen: 'apps/mobile/app/legal/terms-of-use.tsx',
    component: 'TermsOfUseScreen',
  },
  { key: 'support', source: 'docs/legal/support.md', html: 'docs/site/support.html' },
];

/** Where a link to a sibling source points in each output. */
const LINK_TARGETS = {
  './privacy-policy.md': { html: 'privacy.html', route: '/legal/privacy-policy' },
  './terms-of-use.md': { html: 'terms.html', route: '/legal/terms-of-use' },
  './support.md': { html: 'support.html', route: null },
};

/**
 * Public origin of docs/site (Cloudflare Workers, runbook section 4). Pages are served without `.html`
 * (`/privacy`, `/terms`, `/support`): those are the URLs in the builds and App Store Connect, so they are
 * the canonical ones. Internal links keep `.html` so the folder works on any static host.
 */
const SITE_URL = 'https://joinfestie.com';
const canonicalUrl = (key) => (key === 'index' ? `${SITE_URL}/` : `${SITE_URL}/${key}`);

/** Binary files copied verbatim into the site (`--check` compares them byte for byte). */
const ASSETS = [
  { from: 'apps/mobile/assets/images/favicon.png', to: 'docs/site/favicon.png' },
  { from: 'apps/mobile/assets/images/icon.png', to: 'docs/site/apple-touch-icon.png' },
];

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;
const SUPPORT_EMAIL_TOKEN = '__SUPPORT_EMAIL__';
const VALUES_FILE = 'docs/legal/values.json';
const EMAIL_PATTERN = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;

/** Template values; `supportEmail` is '' until the operator decides it. */
function readValues() {
  const values = JSON.parse(readFileSync(rel(VALUES_FILE), 'utf8'));
  const supportEmail = typeof values.supportEmail === 'string' ? values.supportEmail.trim() : '';
  if (supportEmail !== '' && !EMAIL_PATTERN.test(supportEmail)) {
    throw new Error(`${VALUES_FILE}: supportEmail "${supportEmail}" is not an email address`);
  }
  return { supportEmail: supportEmail === '' ? null : supportEmail };
}

/* ─── Markdown subset → blocks ─────────────────────────────────────────── */

/** @typedef {{ t: 'text', v: string } | { t: 'bold', v: string } | { t: 'link', v: string, href: string }} Span */
/** @typedef {{ type: 'h2' | 'h3' | 'p' | 'li', spans: Span[] }} Block */

function parseInline(text, file) {
  /** @type {Span[]} */
  const spans = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) spans.push({ t: 'text', v: text.slice(last, match.index) });
    if (match[1] !== undefined) {
      spans.push({ t: 'bold', v: match[1] });
    } else {
      const href = match[3];
      if (!(href in LINK_TARGETS) && !/^(https:\/\/|mailto:)/.test(href)) {
        throw new Error(`${file}: unsupported link target "${href}" (use https:, mailto: or a sibling .md)`);
      }
      spans.push({ t: 'link', v: match[2], href });
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) spans.push({ t: 'text', v: text.slice(last) });
  for (const span of spans) {
    if (/\*|`|\]\(/.test(span.v)) {
      throw new Error(`${file}: unsupported or unbalanced Markdown in "${text}"`);
    }
  }
  return spans;
}

function parseDocument(file) {
  const raw = readFileSync(rel(file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const lines = raw.split(/\r?\n/);
  let title = null;
  let updated = null;
  /** @type {Block[]} */
  const blocks = [];
  let paragraph = [];
  let item = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', spans: parseInline(paragraph.join(' '), file) });
    paragraph = [];
  };
  const flushItem = () => {
    if (item !== null) blocks.push({ type: 'li', spans: parseInline(item, file) });
    item = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      flushItem();
      continue;
    }
    if (item !== null && /^ {2,}\S/.test(line)) {
      item += ` ${trimmed}`;
      continue;
    }
    flushItem();
    let match;
    if ((match = /^# (.+)$/.exec(trimmed))) {
      if (title !== null || blocks.length) throw new Error(`${file}: "# Title" must be the first line and appear once`);
      title = match[1].trim();
    } else if ((match = /^Last updated: (.+)$/.exec(trimmed))) {
      flushParagraph();
      updated = match[1].trim();
    } else if ((match = /^(#{2,3}) (.+)$/.exec(trimmed))) {
      flushParagraph();
      blocks.push({ type: match[1].length === 2 ? 'h2' : 'h3', spans: parseInline(match[2].trim(), file) });
    } else if ((match = /^- (.+)$/.exec(trimmed))) {
      flushParagraph();
      item = match[1];
    } else if (/^(#{4,}|>|\||```|\d+\. )/.test(trimmed)) {
      throw new Error(`${file}: unsupported Markdown construct: "${trimmed}"`);
    } else {
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushItem();
  if (!title) throw new Error(`${file}: missing "# Title"`);
  if (!updated) throw new Error(`${file}: missing "Last updated: …" line`);
  return { title, updated, blocks };
}

/* ─── HTML ─────────────────────────────────────────────────────────────── */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escaped text with the support-email variable as a mailto: link (left as the token until it is set). */
function textToHtml(text, values) {
  const parts = text.split(SUPPORT_EMAIL_TOKEN).map(escapeHtml);
  if (!values.supportEmail) return parts.join(SUPPORT_EMAIL_TOKEN);
  const address = escapeHtml(values.supportEmail);
  return parts.join(`<a href="mailto:${address}">${address}</a>`);
}

function spansToHtml(spans, values) {
  return spans
    .map((span) => {
      if (span.t === 'bold') return `<strong>${textToHtml(span.v, values)}</strong>`;
      if (span.t === 'link') {
        const target = LINK_TARGETS[span.href]?.html ?? span.href;
        return `<a href="${escapeHtml(target)}">${escapeHtml(span.v)}</a>`;
      }
      return textToHtml(span.v, values);
    })
    .join('');
}

function slug(spans) {
  return spans
    .map((s) => s.v)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Ids for every h2/h3 in a document (aligned with `blocks`; null for other blocks). A repeated heading
 * gets `-2`, `-3`… so fragment links stay unique; the first occurrence keeps the plain slug, so existing
 * ids never change.
 */
function headingIds(blocks) {
  const used = new Set();
  return blocks.map((block) => {
    if (block.type !== 'h2' && block.type !== 'h3') return null;
    const base = slug(block.spans);
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

const plainText = (spans) => spans.map((s) => s.v).join('');

/** A search/share snippet: at most `max` characters, cut at a word boundary with "…" only when cut. */
function metaDescription(text, max = 155) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(' ', max - 1);
  return `${clean.slice(0, end > 0 ? end : max - 1).replace(/[\s,;:.(-]+$/, '')}…`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 5, 2026" as `<time datetime="2026-10-05">`; any other form stays plain text. */
function dateHtml(text) {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  const month = match ? MONTHS.indexOf(match[1]) + 1 : 0;
  if (!match || month === 0 || Number(match[2]) < 1 || Number(match[2]) > 31) return escapeHtml(text);
  const iso = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return `<time datetime="${iso}">${escapeHtml(text)}</time>`;
}

/*
 * The web copy of the app's design tokens (packages/ui/src/theme.ts, rules in docs/design-system.md).
 * Node cannot import theme.ts without a build step, so keep the two in step by hand:
 *   --bg = colors.background   --card = colors.surface   --text = colors.textPrimary
 *   --link = colors.link       --link-pressed = colors.linkPressed
 *   --rule = colors.separator (ink 12%)   --fill = colors.fill (ink 5%)
 *   --muted is web-only: an opaque ink (7.1:1 on --bg) in place of the app's 70% textSecondary.
 *   The dark set is web-only too (the app is light-only); every text pair is ≥ 4.5:1 in both schemes.
 *   Radii: card 26 (radii.card; 22 = radii.xl on phones), tiles 18 (radii.lg), controls 14 (radii.md),
 *   the app icon 22.37% (iconRadius). The card shadow is elevation.card.
 *   Type: rem on a 17px root (HIG body). On iOS the root follows Dynamic Type (`-apple-system-body`),
 *   because the app opens these pages in a Safari sheet; the `-webkit-touch-callout` test keeps that to
 *   iOS, since macOS Safari would resolve the keyword to its 13px body. h1 ≈ largeTitle in the app's
 *   display face (bold italic Georgia), h2 ≈ headline-weight system text, h3 = headline, the "Last updated"
 *   line ≈ subheadline. The brand link keeps the rounded system stack.
 *   Measure: --measure is 56ch. A ch is the width of "0", wider than an average prose character, so 56ch
 *   is about 65 characters per line. header/main/footer add back the article's widest --pad (44px) and the
 *   gutter on each side, so the article's text column is exactly --measure once --pad reaches 44px.
 *   Motion: link colour fades (120ms) and smooth anchor scrolling only without Reduce Motion.
 */
const SITE_CSS = `
:root {
  --bg: #FFF5F9; --card: #FFFFFF; --text: #2C3327; --muted: #4F564A;
  --link: #2F5DA8; --link-pressed: #244A87; --rule: rgba(44, 51, 39, .12); --fill: rgba(44, 51, 39, .05);
  --gutter: 16px; --pad: clamp(20px, 5vw, 44px); --radius: 22px; --measure: 56ch;
  --rounded: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif;
  --display: Georgia, "Times New Roman", serif;
}
@media (min-width: 600px) { :root { --radius: 26px; } }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1B1D1A; --card: #262924; --text: #EEF0EA; --muted: #C0C6BA; --link: #9DBBF5; --link-pressed: #BFD3F8; --rule: rgba(238, 240, 234, .14); --fill: rgba(238, 240, 234, .06); }
}
* { box-sizing: border-box; }
html { font-size: 106.25%; -webkit-text-size-adjust: 100%; }
@supports (font: -apple-system-body) and (-webkit-touch-callout: none) { html { font: -apple-system-body; } }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } a { transition: color 120ms ease; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 1rem/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow-wrap: break-word; }
a { color: var(--link); text-decoration-thickness: from-font; text-underline-offset: .18em; }
a:hover, a:active { color: var(--link-pressed); }
a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
a:not(.skip):focus-visible { border-radius: 4px; }
.skip { position: absolute; left: -999px; top: 8px; z-index: 1; display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; background: var(--card); border-radius: 14px; }
.skip:focus { left: var(--gutter); }
header, main, footer { max-width: calc(var(--measure) + 2 * 44px + 2 * var(--gutter)); margin: 0 auto; padding: 0 var(--gutter); }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: 1.5rem; padding-top: 8px; }
a.brand { display: inline-flex; align-items: center; min-height: 44px; font-family: var(--rounded); font-weight: 700; font-size: 1.3rem; color: var(--text); text-decoration: none; }
header nav ul { list-style: none; display: flex; flex-wrap: wrap; column-gap: 1.25rem; margin: 0; padding: 0; font-size: .88rem; font-weight: 600; }
header nav li + li { margin-top: 0; }
header nav a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }
header nav a:hover { text-decoration-line: underline; }
header nav a[aria-current="page"] { color: var(--text); text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: .4em; }
article { background: var(--card); border-radius: var(--radius); padding: clamp(24px, 5vw, 40px) var(--pad) clamp(28px, 5vw, 44px); margin: 12px 0 32px; box-shadow: 0 3px 10px rgba(44, 51, 39, .05); }
h1, h2, h3 { text-wrap: balance; }
p, li { text-wrap: pretty; }
h1 { font-family: var(--display); font-style: italic; font-weight: 700; font-size: 2rem; line-height: 1.2; margin: 0 0 .4rem; }
h2 { font-size: 1.3rem; line-height: 1.27; font-weight: 650; margin: 2.4em 0 .5em; }
h3 { font-size: 1rem; line-height: 1.4; font-weight: 600; margin: 1.5em 0 .25em; }
h2 + h3 { margin-top: .75em; }
h2, h3 { scroll-margin-top: 1rem; }
strong { font-weight: 600; }
p, ul, ol { margin: 0 0 .8em; }
ul, ol { padding-left: 1.25em; }
li + li { margin-top: .4em; }
li::marker { color: var(--muted); }
.updated { font-size: .88rem; color: var(--muted); margin: 0 0 1.5rem; }
.toc { margin: 0 0 1.5rem; }
.toc details { background: var(--fill); border-radius: 14px; }
.toc summary { position: relative; display: block; min-height: 44px; padding: .55em 48px .55em 16px; border-radius: 14px; font-weight: 600; cursor: pointer; list-style: none; }
.toc summary::-webkit-details-marker { display: none; }
.toc summary::after { content: ""; position: absolute; right: 20px; top: 50%; width: .45em; height: .45em; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: translateY(-70%) rotate(45deg); }
.toc details[open] > summary::after { transform: translateY(-30%) rotate(-135deg); }
.toc summary:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.toc ol { list-style: none; margin: 0; padding: 0 16px 8px; }
.toc li + li { margin-top: 0; }
.toc a { display: flex; align-items: center; min-height: 44px; padding: 4px 0; line-height: 1.35; text-decoration: none; }
.toc a:hover { text-decoration-line: underline; }
.home { padding: 16px 0 32px; }
.home section + section { margin-top: 2.25rem; }
.home h2 { margin-top: 0; }
.home p, .home ul:not(.features) { max-width: var(--measure); }
.app-icon { display: block; width: 88px; height: 88px; border-radius: 22.37%; box-shadow: 0 1px 2px rgba(44, 51, 39, .1), 0 6px 16px rgba(44, 51, 39, .14); margin: 0 0 20px; }
.lead { font-size: 1.3rem; line-height: 1.3; font-weight: 600; margin: 0 0 .6em; }
.meta { font-size: .88rem; color: var(--muted); }
.features { list-style: none; display: grid; gap: 12px; margin: 0; padding: 0; }
.features li { margin: 0; padding: 20px; background: var(--fill); border-radius: 18px; }
.features h3 { margin: 0 0 .25em; }
.features p { margin: 0; }
footer { padding-bottom: 40px; color: var(--muted); }
footer p, footer ul { font-size: .82rem; }
.footer-links { list-style: none; display: flex; flex-wrap: wrap; column-gap: 1.25rem; margin: 0; padding: 4px 0 0; border-top: 1px solid var(--rule); }
.footer-links li + li { margin-top: 0; }
.footer-links a { display: inline-flex; align-items: center; min-height: 44px; overflow-wrap: anywhere; }
@media (min-width: 600px) { h1 { font-size: 2.35rem; } .home section + section { margin-top: 3rem; } }
@media (min-width: 720px) {
  .toc ol { columns: 2; column-gap: 32px; }
  .toc li { break-inside: avoid; }
  .features { grid-template-columns: 1fr 1fr; gap: 16px; }
  .features li:first-child { grid-column: 1 / -1; }
}
@media print {
  :root { --bg: #FFFFFF; --card: #FFFFFF; --text: #000000; --muted: #000000; --link: #000000; --link-pressed: #000000; --fill: transparent; }
  body { background: #FFFFFF; color: #000000; }
  .skip, header nav, .toc, .footer-links { display: none; }
  header, main, footer { max-width: none; padding: 0; }
  article { margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
  .features li { padding: 0; }
  .app-icon { box-shadow: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; }
  h2, h3 { break-after: avoid; }
  p, li { break-inside: avoid; }
}
`.trim();

const NAV = [
  { key: 'privacy', href: 'privacy.html', label: 'Privacy Policy' },
  { key: 'terms', href: 'terms.html', label: 'Terms of Use' },
  { key: 'support', href: 'support.html', label: 'Support' },
];

const HOME_TITLE = 'Festie: plan your festival with your crew';

function pageShell({ key, title, description, body, values }) {
  const pageTitle = key === 'index' ? HOME_TITLE : `${title} · Festie`;
  const url = canonicalUrl(key);
  const nav = NAV.map(
    (item) => `<li><a href="${item.href}"${item.key === key ? ' aria-current="page"' : ''}>${item.label}</a></li>`,
  ).join('');
  const footerLinks = [
    ...NAV.map((item) => `<li><a href="${item.href}">${item.label}</a></li>`),
    ...(values.supportEmail ? [`<li>${textToHtml(SUPPORT_EMAIL_TOKEN, values)}</li>`] : []),
  ].join('');
  return `<!doctype html>
<!-- Generated by docs/legal/generate.mjs. Do not edit: change the Markdown source and regenerate. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#FFF5F9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1B1D1A" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="favicon.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Festie">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/apple-touch-icon.png">
<style>
${SITE_CSS}
</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header>
<a class="brand" href="index.html"${key === 'index' ? ' aria-current="page"' : ''}>Festie</a>
<nav aria-label="Festie pages"><ul role="list">${nav}</ul></nav>
</header>
<main id="content">
${body}
</main>
<footer>
<ul class="footer-links" role="list">${footerLinks}</ul>
<p>Festie is an independent app and is not affiliated with or endorsed by any festival, organizer or artist.</p>
</footer>
</body>
</html>
`;
}

/** Documents with at least this many h2 get an "On this page" index (web only; RN cannot jump to anchors). */
const TOC_MIN_SECTIONS = 6;

function tocHtml(doc, ids) {
  const sections = doc.blocks.flatMap((block, index) =>
    block.type === 'h2' ? [`<li><a href="#${ids[index]}">${escapeHtml(plainText(block.spans))}</a></li>`] : [],
  );
  if (sections.length < TOC_MIN_SECTIONS) return null;
  return [
    '<nav class="toc" aria-labelledby="toc-title"><details><summary id="toc-title">On this page</summary><ol role="list">',
    ...sections,
    '</ol></details></nav>',
  ].join('\n');
}

function renderHtml(doc, key, values) {
  const ids = headingIds(doc.blocks);
  const parts = [`<article>`, `<h1>${escapeHtml(doc.title)}</h1>`, `<p class="updated">Last updated: ${dateHtml(doc.updated)}</p>`];
  const toc = tocHtml(doc, ids);
  if (toc) parts.push(toc);
  let inList = false;
  doc.blocks.forEach((block, index) => {
    if (block.type !== 'li' && inList) {
      parts.push('</ul>');
      inList = false;
    }
    if (block.type === 'li') {
      if (!inList) parts.push('<ul>');
      inList = true;
      parts.push(`<li>${spansToHtml(block.spans, values)}</li>`);
    } else if (block.type === 'p') {
      parts.push(`<p>${spansToHtml(block.spans, values)}</p>`);
    } else {
      parts.push(`<${block.type} id="${ids[index]}">${spansToHtml(block.spans, values)}</${block.type}>`);
    }
  });
  if (inList) parts.push('</ul>');
  parts.push('</article>');
  const firstParagraph = doc.blocks.find((b) => b.type === 'p');
  const plain = firstParagraph ? plainText(firstParagraph.spans) : doc.title;
  const description = metaDescription(values.supportEmail ? plain.split(SUPPORT_EMAIL_TOKEN).join(values.supportEmail) : plain);
  return pageShell({ key, title: doc.title, description, body: parts.join('\n'), values });
}

/**
 * The home page: what the app does, built only from facts stated in the repository (README, the
 * privacy policy and support page, app.json). It claims nothing about availability.
 */
const HOME_FEATURES = [
  ['Your schedule', 'Pick the sets you want to see; Festie flags clashes, and the map shows what is up next on each stage.'],
  ["Your crew's picks", 'Create a crew, invite friends with a 6-character code or a link, and see which sets everyone picked.'],
  ['Meetups', 'Plan a meetup with a time, a stage or a pin on the festival map, and an optional totem photo so your crew can spot where to meet.'],
  [
    'Location only when you choose',
    'Share your location with the crew you choose, for 1, 4 or 8 hours or until you stop (24 hours at most), and only while Festie is open. It is visible to your crew for at most 15 minutes after the last update, then deleted.',
  ],
  ['Works without signal', 'Schedules, crews and meetups are saved on your phone and sync when you are back online, and you can download the festival map.'],
];

const HOME_PRIVACY = [
  'No ads, no tracking, and no analytics, crash-reporting or advertising SDKs.',
  'Photos are stripped of their location and camera details before they leave your phone.',
  'Your own location dot on the map stays on your phone.',
  'Festie does not access your contacts or your microphone.',
  'You can delete your account at any time in Settings.',
];

function renderIndex(values) {
  // TODO: once App Store listing 6761392490 is live, link to it here (APP_STORE_URL in
  // apps/mobile/src/config/app-info.ts) and add an apple-itunes-app meta tag for this page. Nothing in the
  // repository shows the listing is live yet, so the page has no download link or badge.
  const supportLink = '<a href="support.html">Support page</a>';
  const help = values.supportEmail
    ? `For help with Festie, see the ${supportLink} or email ${textToHtml(SUPPORT_EMAIL_TOKEN, values)}.`
    : `For help with Festie, see the ${supportLink}.`;
  const body = [
    '<div class="home">',
    '<section class="hero" aria-labelledby="festie">',
    '<img class="app-icon" src="apple-touch-icon.png" width="88" height="88" alt="">',
    '<h1 id="festie">Festie</h1>',
    '<p class="lead">Plan your festival with your crew.</p>',
    '<p>Festie helps you plan a music festival with your crew: build your schedule, see which sets your friends picked, set up meetups and, only when you choose, share your location with your crew.</p>',
    '<p class="meta">Free, for iPhone. No ads, no tracking.</p>',
    '</section>',
    '<section aria-labelledby="what-you-can-do">',
    '<h2 id="what-you-can-do">What you can do</h2>',
    '<ul class="features" role="list">',
    ...HOME_FEATURES.map(([title, text]) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></li>`),
    '</ul>',
    '</section>',
    '<section aria-labelledby="private-by-design">',
    '<h2 id="private-by-design">Private by design</h2>',
    '<ul>',
    ...HOME_PRIVACY.map((text) => `<li>${escapeHtml(text)}</li>`),
    '</ul>',
    '<p><a href="privacy.html">Read the privacy policy</a></p>',
    '</section>',
    '<section aria-labelledby="help">',
    '<h2 id="help">Help</h2>',
    `<p>${help}</p>`,
    '</section>',
    '</div>',
  ].join('\n');
  return pageShell({ key: 'index', title: 'Festie', description: 'Festie: plan your festival with your crew.', body, values });
}

/* ─── In-app screen (React Native) ─────────────────────────────────────── */

function toScreenBlocks(doc) {
  return doc.blocks.map((block) => ({
    type: block.type,
    spans: block.spans.map((span) => {
      if (span.t === 'link') {
        const target = LINK_TARGETS[span.href];
        if (target) {
          return target.route ? { kind: 'route', text: span.v, href: target.route } : { kind: 'text', text: span.v };
        }
        return { kind: 'url', text: span.v, href: span.href };
      }
      return { kind: span.t, text: span.v };
    }),
  }));
}

function renderScreen(doc, { source, component }, values) {
  const content = JSON.stringify(toScreenBlocks(doc), null, 2);
  return `/**
 * GENERATED by docs/legal/generate.mjs from ${source}. Do not edit by hand: change the Markdown and run
 * \`node docs/legal/generate.mjs\` (CI fails with \`--check\` when this file is out of date).
 */
import { colors, layout, spacing, textStyles } from '@festival/ui';
import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SUPPORT_EMAIL } from '@/src/config/app-info';

type Span =
  | { kind: 'text' | 'bold'; text: string }
  | { kind: 'route'; text: string; href: string }
  | { kind: 'url'; text: string; href: string };

type Block = { type: 'h2' | 'h3' | 'p' | 'li'; spans: Span[] };

const TITLE = ${JSON.stringify(doc.title)};
const UPDATED = ${JSON.stringify(doc.updated)};
const SUPPORT_EMAIL_TOKEN = '${SUPPORT_EMAIL_TOKEN}';
/** docs/legal/values.json \`supportEmail\`, used only when the build has no EXPO_PUBLIC_SUPPORT_EMAIL. */
const SUPPORT_EMAIL_FALLBACK: string | null = ${JSON.stringify(values.supportEmail)};
const SUPPORT_ADDRESS = SUPPORT_EMAIL ?? SUPPORT_EMAIL_FALLBACK;

const CONTENT: Block[] = ${content};

function openUrl(href: string): void {
  if (href.startsWith('https://')) {
    WebBrowser.openBrowserAsync(href).catch(() => Linking.openURL(href).catch(() => undefined));
  } else {
    Linking.openURL(href).catch(() => undefined);
  }
}

/** Plain text, with the support-email variable replaced by the configured, tappable address. */
function renderText(text: string, key: string): React.ReactNode {
  const address = SUPPORT_ADDRESS;
  if (!address || !text.includes(SUPPORT_EMAIL_TOKEN)) {
    return text;
  }
  return text.split(SUPPORT_EMAIL_TOKEN).map((part, index) => (
    <React.Fragment key={\`\${key}-\${index}\`}>
      {index > 0 ? (
        <Text style={styles.link} accessibilityRole="link" onPress={() => openUrl(\`mailto:\${address}\`)}>
          {address}
        </Text>
      ) : null}
      {part}
    </React.Fragment>
  ));
}

function renderSpans(spans: Span[], blockKey: string): React.ReactNode[] {
  return spans.map((span, index) => {
    const key = \`\${blockKey}-\${index}\`;
    switch (span.kind) {
      case 'bold':
        return (
          <Text key={key} style={styles.bold}>
            {renderText(span.text, key)}
          </Text>
        );
      case 'route':
        return (
          <Text key={key} style={styles.link} accessibilityRole="link" onPress={() => router.push(span.href as never)}>
            {span.text}
          </Text>
        );
      case 'url':
        return (
          <Text key={key} style={styles.link} accessibilityRole="link" onPress={() => openUrl(span.href)}>
            {span.text}
          </Text>
        );
      default:
        return <React.Fragment key={key}>{renderText(span.text, key)}</React.Fragment>;
    }
  });
}

export default function ${component}() {
  return (
    <>
      <Stack.Screen options={{ title: TITLE }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <Text style={styles.updated}>Last updated: {UPDATED}</Text>
        {CONTENT.map((block, index) => {
          const key = \`b\${index}\`;
          if (block.type === 'h2' || block.type === 'h3') {
            return (
              <Text key={key} style={block.type === 'h2' ? styles.h2 : styles.h3} accessibilityRole="header">
                {renderSpans(block.spans, key)}
              </Text>
            );
          }
          if (block.type === 'li') {
            return (
              <View key={key} style={styles.listItem}>
                <Text style={styles.bullet} importantForAccessibility="no" accessibilityElementsHidden>
                  •
                </Text>
                <Text style={[styles.body, styles.listText]}>{renderSpans(block.spans, key)}</Text>
              </View>
            );
          }
          return (
            <Text key={key} style={styles.body}>
              {renderSpans(block.spans, key)}
            </Text>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  container: { padding: layout.screenGutter, paddingBottom: spacing.xxxl + spacing.xl, gap: spacing.sm },
  updated: { ...textStyles.footnote, color: colors.textSecondary, marginBottom: spacing.sm },
  h2: { ...textStyles.title3, color: colors.textPrimary, marginTop: spacing.lg },
  h3: { ...textStyles.headline, color: colors.textPrimary, marginTop: spacing.sm },
  body: { ...textStyles.body, color: colors.textPrimary },
  bold: { fontWeight: '600' },
  link: { color: colors.link, fontWeight: '600', textDecorationLine: 'underline' },
  listItem: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xs },
  // textSecondary, not textTertiary: mirrors the web's muted li::marker and keeps the bullet above 3:1.
  bullet: { ...textStyles.body, color: colors.textSecondary },
  listText: { flex: 1 },
});
`;
}

/* ─── Main ─────────────────────────────────────────────────────────────── */

function outputs(values) {
  /** @type {Map<string, string | Buffer>} */
  const files = new Map();
  for (const entry of DOCUMENTS) {
    const doc = parseDocument(entry.source);
    files.set(entry.html, renderHtml(doc, entry.key, values));
    if (entry.screen) files.set(entry.screen, renderScreen(doc, entry, values));
  }
  files.set('docs/site/index.html', renderIndex(values));
  for (const asset of ASSETS) files.set(asset.to, readFileSync(rel(asset.from)));
  return files;
}

/** True when `file` on disk matches: text ignoring CRLF line endings, binary byte for byte. */
function isCurrent(file, content) {
  if (!existsSync(rel(file))) return false;
  const current = readFileSync(rel(file));
  if (Buffer.isBuffer(content)) return current.equals(content);
  return current.toString('utf8').replace(/\r\n/g, '\n') === content;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const values = readValues();
  if (args.has('--release')) {
    const leftovers = [];
    for (const entry of DOCUMENTS) {
      const text = readFileSync(rel(entry.source), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const token of new Set(text.match(PLACEHOLDER) ?? [])) {
        if (token !== SUPPORT_EMAIL_TOKEN) leftovers.push(`${entry.source}: ${token}`);
      }
    }
    if (!values.supportEmail) {
      leftovers.push(`${VALUES_FILE}: supportEmail is empty`);
    }
    const buildEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim();
    if (values.supportEmail && buildEmail && buildEmail.toLowerCase() !== values.supportEmail.toLowerCase()) {
      leftovers.push(`${VALUES_FILE}: supportEmail differs from EXPO_PUBLIC_SUPPORT_EMAIL (${buildEmail})`);
    }
    if (leftovers.length) {
      console.error(`Not ready for release (fix these, then regenerate):\n  ${leftovers.join('\n  ')}`);
      process.exit(1);
    }
    console.log('No placeholders left in the legal sources; support email set.');
  }

  const files = outputs(values);
  if (args.has('--check')) {
    const stale = [...files].filter(([file, content]) => !isCurrent(file, content));
    if (stale.length) {
      console.error(
        `Generated legal files are out of date:\n  ${stale.map(([f]) => f).join('\n  ')}\nRun: node docs/legal/generate.mjs`,
      );
      process.exit(1);
    }
    console.log(`Legal pages up to date (${files.size} files).`);
    return;
  }
  if (args.has('--release')) return;
  for (const [file, content] of files) {
    mkdirSync(path.dirname(rel(file)), { recursive: true });
    writeFileSync(rel(file), content);
    console.log(`wrote ${file}`);
  }
}

main();
