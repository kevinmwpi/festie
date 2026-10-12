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
 *                        apps/mobile/app/legal/{privacy-policy,terms-of-use}.tsx
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

const SITE_CSS = `
:root { --bg: #FFF5F9; --card: #FFFFFF; --text: #2C3327; --muted: #4F564A; --link: #2F5DA8; --rule: #F0E1E8; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
a { color: var(--link); text-underline-offset: 2px; }
a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; border-radius: 4px; }
.skip { position: absolute; left: -999px; top: 8px; background: var(--card); padding: 8px 12px; border-radius: 8px; }
.skip:focus { left: 16px; }
header, main, footer { max-width: 720px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 24px; }
nav ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; font-size: 15px; font-weight: 600; }
nav a[aria-current="page"] { color: var(--text); text-decoration: none; }
.brand { font-family: ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif; font-weight: 700; font-size: 22px; color: var(--text); text-decoration: none; display: inline-block; margin-bottom: 8px; }
article { background: var(--card); border-radius: 32px; padding: 28px 22px 32px; margin: 20px 0; }
h1 { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-size: 32px; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 21px; line-height: 1.3; margin: 32px 0 8px; }
h3 { font-size: 17px; line-height: 1.4; margin: 22px 0 4px; }
p, ul { margin: 0 0 12px; }
ul { padding-left: 22px; }
li { margin-bottom: 6px; }
.updated { font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); margin-bottom: 20px; }
footer { padding-bottom: 40px; font-size: 14px; color: var(--muted); }
@media (min-width: 600px) { article { padding: 40px 44px 44px; } h1 { font-size: 38px; } }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1B1D1A; --card: #262924; --text: #EEF0EA; --muted: #C0C6BA; --link: #9DBBF5; --rule: #3A3E37; }
}
`.trim();

const NAV = [
  { key: 'privacy', href: 'privacy.html', label: 'Privacy Policy' },
  { key: 'terms', href: 'terms.html', label: 'Terms of Use' },
  { key: 'support', href: 'support.html', label: 'Support' },
];

function pageShell({ key, title, description, body }) {
  const nav = NAV.map(
    (item) => `<li><a href="${item.href}"${item.key === key ? ' aria-current="page"' : ''}>${item.label}</a></li>`,
  ).join('');
  return `<!doctype html>
<!-- Generated by docs/legal/generate.mjs. Do not edit: change the Markdown source and regenerate. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${escapeHtml(description)}">
<title>${escapeHtml(title)} · Festie</title>
<style>
${SITE_CSS}
</style>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header>
<a class="brand" href="index.html">Festie</a>
<nav aria-label="Festie pages"><ul>${nav}</ul></nav>
</header>
<main id="content">
${body}
</main>
<footer>
<p>Festie is an independent app and is not affiliated with or endorsed by any festival, organizer or artist.</p>
</footer>
</body>
</html>
`;
}

function renderHtml(doc, key, values) {
  const parts = [`<article>`, `<h1>${escapeHtml(doc.title)}</h1>`, `<p class="updated">Last updated: ${escapeHtml(doc.updated)}</p>`];
  let inList = false;
  for (const block of doc.blocks) {
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
      parts.push(`<${block.type} id="${slug(block.spans)}">${spansToHtml(block.spans, values)}</${block.type}>`);
    }
  }
  if (inList) parts.push('</ul>');
  parts.push('</article>');
  const firstParagraph = doc.blocks.find((b) => b.type === 'p');
  const plain = firstParagraph ? firstParagraph.spans.map((s) => s.v).join('') : doc.title;
  const description = snippet(values.supportEmail ? plain.split(SUPPORT_EMAIL_TOKEN).join(values.supportEmail) : plain);
  return pageShell({ key, title: doc.title, description, body: parts.join('\n') });
}

/**
 * The page's meta description (search results, link previews): the opening sentences that fit in
 * `limit` characters, whole; never a cut mid-word or mid-name. Falls back to a word boundary with an
 * ellipsis when even the first sentence is too long.
 */
function snippet(text, limit = 155) {
  // A sentence ends at . ! or ? followed by whitespace, so the dot of an email address or a domain
  // inside a sentence does not count.
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > limit) break;
    out = next;
  }
  if (out) return out;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function renderIndex() {
  const body = [
    '<article>',
    '<h1>Festie</h1>',
    '<p>Festie helps you plan a music festival with your crew: build your schedule, see which sets your friends picked, set up meetups and, only when you choose, share your location with your crew.</p>',
    '<ul>',
    ...NAV.map((item) => `<li><a href="${item.href}">${item.label}</a></li>`),
    '</ul>',
    '</article>',
  ].join('\n');
  return pageShell({ key: 'index', title: 'Festie', description: 'Festie: plan your festival with your crew.', body });
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
import { colors, spacing, typography } from '@festival/ui';
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
  container: { padding: spacing.lg, paddingBottom: spacing.xxxl + spacing.xl, gap: spacing.sm },
  updated: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  h2: { ...typography.heading, color: colors.textPrimary, fontSize: 21, lineHeight: 27, marginTop: spacing.lg },
  h3: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', lineHeight: 22, marginTop: spacing.sm },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  bold: { fontWeight: '700' },
  link: { color: colors.link, fontWeight: '600', textDecorationLine: 'underline' },
  listItem: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xs },
  bullet: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  listText: { flex: 1 },
});
`;
}

/* ─── Main ─────────────────────────────────────────────────────────────── */

function outputs(values) {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const entry of DOCUMENTS) {
    const doc = parseDocument(entry.source);
    files.set(entry.html, renderHtml(doc, entry.key, values));
    if (entry.screen) files.set(entry.screen, renderScreen(doc, entry, values));
  }
  files.set('docs/site/index.html', renderIndex());
  return files;
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
    const stale = [...files].filter(([file, text]) => !existsSync(rel(file)) || readFileSync(rel(file), 'utf8') !== text);
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
  for (const [file, text] of files) {
    mkdirSync(path.dirname(rel(file)), { recursive: true });
    writeFileSync(rel(file), text);
    console.log(`wrote ${file}`);
  }
}

main();
