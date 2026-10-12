/**
 * Local review tool for candidate festival bundles (`npm run admin -- review:serve`). A small
 * `node:http` server on 127.0.0.1 that lists the candidates under seed-data/candidates/, shows each
 * one next to its sources, and records the reviewer's decisions through ../candidates/store. It has
 * write access to the repository, so it binds to the loopback interface only, serves no CORS headers,
 * rejects cross-origin writes, and only ever reads image files from a candidate's media/ directory.
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  listCandidates,
  loadCandidate,
  promoteCandidate,
  saveCandidateMediaReview,
  saveCandidateReview,
  type LoadedCandidate,
} from '../candidates/store';
import { CANDIDATE_SECTIONS, type CandidateReview, type CandidateSection, type SectionDecision } from '../candidates/types';
import { repoRoot, resolveInputPath, UsageError } from '../env';
import type { MediaReview, MediaReviewStatus } from '../media/types';
import { buildCandidateView, type CandidateView } from './view';

export const DEFAULT_PORT = 8787;
export const DEFAULT_HOST = '127.0.0.1';
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_NOTE_LENGTH = 20_000;
const SECTION_DECISIONS: readonly SectionDecision[] = ['pending', 'approved', 'rejected'];
const MEDIA_STATUSES: readonly MediaReviewStatus[] = ['pending', 'approved', 'rejected'];
const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const MEDIA_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export type Log = (line: string) => void;

export interface ReviewServerOptions {
  port?: number;
  host?: string;
  /** The seed-data directory (passed through to the candidate store); default: <repo>/seed-data. */
  root?: string;
  /** Open the page in the default browser once listening. */
  open?: boolean;
  log?: Log;
}

export interface ReviewServer {
  server: Server;
  url: string;
  root: string;
  close(): Promise<void>;
}

/** What `GET /api/candidates/:slug` returns. */
export interface CandidateDetail extends LoadedCandidate {
  view: CandidateView;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// --- validation ---------------------------------------------------------------------------------

function requireSlug(raw: string): string {
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'Invalid slug');
  }
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, 'Invalid slug: expected lower-case letters, digits and single hyphens');
  }
  return slug;
}

function requireIndex(raw: string): number {
  if (!/^(0|[1-9]\d{0,5})$/.test(raw)) {
    throw new HttpError(400, 'Invalid media index: expected a non-negative integer');
  }
  return Number(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters`);
  }
  return trimmed === '' ? null : trimmed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function parseReviewBody(body: unknown): CandidateReview {
  if (!isRecord(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  if (!isRecord(body.decisions)) {
    throw new HttpError(400, 'decisions must be an object with one decision per section');
  }
  const decisions = {} as Record<CandidateSection, SectionDecision>;
  for (const section of CANDIDATE_SECTIONS) {
    decisions[section] = oneOf(body.decisions[section], SECTION_DECISIONS, `decisions.${section}`);
  }
  const unknown = Object.keys(body.decisions).filter((key) => !CANDIDATE_SECTIONS.includes(key as CandidateSection));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown section(s): ${unknown.join(', ')}`);
  }
  return {
    decisions,
    by: optionalText(body.by, 'by', MAX_NAME_LENGTH),
    at: new Date().toISOString(),
    notes: optionalText(body.notes, 'notes', MAX_NOTE_LENGTH),
  };
}

export function parseMediaReviewBody(body: unknown): MediaReview {
  if (!isRecord(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  return {
    status: oneOf(body.status, MEDIA_STATUSES, 'status'),
    by: optionalText(body.by, 'by', MAX_NAME_LENGTH),
    at: new Date().toISOString(),
    note: optionalText(body.note, 'note', MAX_NOTE_LENGTH),
  };
}

export function parsePromoteBody(body: unknown): { dryRun: boolean } {
  if (!isRecord(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  if (typeof body.dryRun !== 'boolean') {
    throw new HttpError(400, 'dryRun must be a boolean');
  }
  return { dryRun: body.dryRun };
}

/** The path after `/media/<slug>/`, checked before it goes anywhere near the file system. */
export function checkMediaPath(raw: string): string {
  let rel: string;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'Invalid media path');
  }
  if (rel.includes('\0') || rel.includes('\\') || !MEDIA_PATH_PATTERN.test(rel)) {
    throw new HttpError(400, 'Invalid media path');
  }
  if (rel.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new HttpError(400, 'Invalid media path');
  }
  if (!IMAGE_TYPES[path.posix.extname(rel).toLowerCase()]) {
    throw new HttpError(400, 'Only .jpg, .png and .webp files are served');
  }
  return rel;
}

// --- http plumbing ------------------------------------------------------------------------------

function baseHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  baseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, type: string, body: string | Buffer, extra?: Record<string, string>): void {
  baseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  for (const [name, value] of Object.entries(extra ?? {})) {
    res.setHeader(name, value);
  }
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Body too large');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

function isLoopbackHost(hostname: string, serverHost: string): boolean {
  const name = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === serverHost.toLowerCase();
}

/** Writes come from the page itself: same loopback host and port, and never cross-site. */
function requireSameOrigin(req: IncomingMessage, host: string, port: number): void {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Cross-site requests are not allowed');
  }
  for (const header of ['origin', 'host'] as const) {
    const value = req.headers[header];
    if (typeof value !== 'string' || value === '') {
      continue;
    }
    let url: URL;
    try {
      url = new URL(header === 'host' ? `http://${value}` : value);
    } catch {
      throw new HttpError(403, `Invalid ${header} header`);
    }
    const urlPort = url.port === '' ? '80' : url.port;
    if (!isLoopbackHost(url.hostname, host) || urlPort !== String(port)) {
      throw new HttpError(403, `Requests must come from http://${host}:${port}`);
    }
  }
}

function toHttpError(error: unknown, fallbackStatus: number): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || /\bnot found\b|\bdoes not exist\b|\bno such\b|\bunknown candidate\b/i.test(message)) {
    return new HttpError(404, message);
  }
  return new HttpError(fallbackStatus, message);
}

const PAGE_LOCATIONS = [path.join(__dirname, 'page.html'), path.join(__dirname, '../../src/review/page.html')];

/** page.html next to this file (src) or back in src when running from dist. */
export function pagePath(): string {
  const found = PAGE_LOCATIONS.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`page.html not found (looked in ${PAGE_LOCATIONS.join(', ')})`);
  }
  return found;
}

// --- handlers -----------------------------------------------------------------------------------

interface Context {
  host: string;
  port: number;
  root: string | undefined;
  /** Candidate directories seen so far, so image requests do not reload the bundle. */
  dirs: Map<string, string>;
}

async function getDetail(ctx: Context, slug: string): Promise<CandidateDetail> {
  const loaded = await loadCandidate(slug, ctx.root);
  ctx.dirs.set(slug, loaded.dir);
  return { ...loaded, view: buildCandidateView(loaded) };
}

async function serveMedia(ctx: Context, res: ServerResponse, slug: string, rel: string): Promise<void> {
  let dir = ctx.dirs.get(slug);
  if (!dir) {
    dir = (await loadCandidate(slug, ctx.root)).dir;
    ctx.dirs.set(slug, dir);
  }
  const mediaDir = path.resolve(dir, 'media');
  const full = path.resolve(mediaDir, ...rel.split('/'));
  if (full !== mediaDir && !full.startsWith(mediaDir + path.sep)) {
    throw new HttpError(400, 'Invalid media path');
  }
  let realMediaDir: string;
  let realFile: string;
  try {
    [realMediaDir, realFile] = await Promise.all([fs.realpath(mediaDir), fs.realpath(full)]);
  } catch {
    throw new HttpError(404, 'Image not found');
  }
  // A symlink inside media/ must not lead outside it.
  if (!realFile.startsWith(realMediaDir + path.sep)) {
    throw new HttpError(404, 'Image not found');
  }
  const stat = await fs.stat(realFile);
  if (!stat.isFile()) {
    throw new HttpError(404, 'Image not found');
  }
  const type = IMAGE_TYPES[path.posix.extname(rel).toLowerCase()];
  sendText(res, 200, type, await fs.readFile(realFile), { 'Content-Length': String(stat.size) });
}

async function route(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  let match: RegExpExecArray | null;

  if (method === 'GET' || method === 'HEAD') {
    if (pathname === '/' || pathname === '/index.html') {
      const page = await fs.readFile(pagePath(), 'utf8');
      sendText(res, 200, 'text/html; charset=utf-8', page, {
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      });
      return;
    }
    if (pathname === '/healthz') {
      sendText(res, 200, 'text/plain; charset=utf-8', 'ok');
      return;
    }
    if (pathname === '/api/candidates') {
      sendJson(res, 200, await listCandidates(ctx.root));
      return;
    }
    if ((match = /^\/api\/candidates\/([^/]+)$/.exec(pathname))) {
      const slug = requireSlug(match[1]);
      try {
        sendJson(res, 200, await getDetail(ctx, slug));
      } catch (error) {
        throw toHttpError(error, 500);
      }
      return;
    }
    if ((match = /^\/media\/([^/]+)\/(.+)$/.exec(pathname))) {
      const slug = requireSlug(match[1]);
      const rel = checkMediaPath(match[2]);
      try {
        await serveMedia(ctx, res, slug, rel);
      } catch (error) {
        throw toHttpError(error, 500);
      }
      return;
    }
    throw new HttpError(404, 'Not found');
  }

  if (method === 'POST') {
    requireSameOrigin(req, ctx.host, ctx.port);
    if ((match = /^\/api\/candidates\/([^/]+)\/review$/.exec(pathname))) {
      const slug = requireSlug(match[1]);
      const review = parseReviewBody(await readJsonBody(req));
      try {
        sendJson(res, 200, await saveCandidateReview(slug, review, ctx.root));
      } catch (error) {
        throw toHttpError(error, 400);
      }
      return;
    }
    if ((match = /^\/api\/candidates\/([^/]+)\/media\/([^/]+)$/.exec(pathname))) {
      const slug = requireSlug(match[1]);
      const index = requireIndex(match[2]);
      const review = parseMediaReviewBody(await readJsonBody(req));
      try {
        sendJson(res, 200, await saveCandidateMediaReview(slug, index, review, ctx.root));
      } catch (error) {
        throw toHttpError(error, 400);
      }
      return;
    }
    if ((match = /^\/api\/candidates\/([^/]+)\/promote$/.exec(pathname))) {
      const slug = requireSlug(match[1]);
      const { dryRun } = parsePromoteBody(await readJsonBody(req));
      try {
        sendJson(res, 200, await promoteCandidate(slug, { dryRun, root: ctx.root }));
      } catch (error) {
        throw toHttpError(error, 400);
      }
      return;
    }
    throw new HttpError(404, 'Not found');
  }

  res.setHeader('Allow', 'GET, HEAD, POST');
  throw new HttpError(405, 'Method not allowed');
}

// --- server -------------------------------------------------------------------------------------

export async function startReviewServer(options: ReviewServerOptions = {}): Promise<ReviewServer> {
  const host = options.host ?? DEFAULT_HOST;
  const log = options.log ?? (() => undefined);
  const ctx: Context = { host, port: options.port ?? DEFAULT_PORT, root: options.root, dirs: new Map() };

  const server = createServer((req, res) => {
    const started = Date.now();
    route(ctx, req, res)
      .catch((error: unknown) => {
        const httpError = toHttpError(error, 500);
        if (httpError.status >= 500) {
          log(`error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        }
        if (!res.headersSent) {
          sendJson(res, httpError.status, { error: httpError.message });
        } else {
          res.destroy();
        }
      })
      .finally(() => {
        log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      });
  });
  server.requestTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(ctx.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  ctx.port = address.port;
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/`;
  const root = options.root ?? path.join(repoRoot(), 'seed-data');

  if (options.open) {
    openBrowser(url);
  }

  return {
    server,
    url,
    root,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Opening the browser is a convenience; the URL is printed anyway.
  }
}

/** `review:serve`: start the server, print the URL and stay up until Ctrl+C. */
export async function reviewServe(options: ReviewServerOptions = {}): Promise<void> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  // Per-request lines stay quiet unless a logger is given; server-side failures always reach stderr.
  const requestLog: Log = options.log ?? ((line) => {
    if (line.startsWith('error:')) {
      process.stderr.write(`${line}\n`);
    }
  });
  const started = await startReviewServer({ ...options, log: requestLog });
  log(`Festie candidate review: ${started.url}`);
  log(`Candidates: ${path.join(started.root, 'candidates')}`);
  log('Local only (127.0.0.1). Press Ctrl+C to stop.');
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      log('Stopping.');
      void started.close().then(resolve, resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export const REVIEW_SERVE_USAGE = 'review:serve [--port <n>] [--root <seed-data dir>] [--open]';

/** CLI wrapper: `'review:serve': (args) => reviewServeCommand(args, log)` in cli.ts. */
export async function reviewServeCommand(args: string[], log: Log): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { port: { type: 'string' }, root: { type: 'string' }, open: { type: 'boolean' } },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nUsage: ${REVIEW_SERVE_USAGE}`);
  }
  const { values } = parsed;
  let port = DEFAULT_PORT;
  if (typeof values.port === 'string') {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new UsageError('--port must be an integer between 0 and 65535');
    }
  }
  let root: string | undefined;
  if (typeof values.root === 'string') {
    root = resolveInputPath(values.root);
    if (!existsSync(root)) {
      throw new UsageError(`--root ${root} does not exist (expected the seed-data directory)`);
    }
  }
  await reviewServe({ port, root, open: values.open === true, log });
}
