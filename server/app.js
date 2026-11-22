// ReviewHub API, independent of where data lives. `store` is either the local workspace (store-fs.js) or the hosted
// cloud store (store-cloud.js: Neon Postgres + Vercel Blob). server/index.js runs it locally, api/index.js on Vercel.
import express from 'express';
import multer from 'multer';
import compression from 'compression';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './workspace.js';
import { installAuth } from './auth.js';
import { cleanFileName, httpError, parseAgentLogs, safeId } from './util.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const MAX_FILE_BYTES = 300 * 1024 * 1024;

export function createApp(store, { authRequired = false } = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.use(compression());
  // Large reviews: the browser gzips big saves (Content-Encoding: gzip); express.json inflates them.
  app.use(express.json({ limit: '200mb' }));
  installAuth(app, { required: authRequired });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---- workspace -------------------------------------------------------------
  app.get('/api/info', (_req, res) => res.json({ version: VERSION, storage: store.kind, ...store.info() }));

  // Change where reviews are stored (local only). Body: { path, copy }.
  app.put('/api/workspace', wrap(async (req, res) => res.json(await store.setWorkspace(req.body?.path, !!req.body?.copy))));

  // ---- reviews ---------------------------------------------------------------
  app.get('/api/reviews', wrap(async (_req, res) => {
    const out = (await store.listReviews()).map((r) => ({
      id: r.id, title: r.title, type: r.type, createdAt: r.createdAt, updatedAt: r.updatedAt,
      records: r.records?.length ?? 0, runs: r.runs?.length ?? 0,
      reviewers: (r.reviewers || []).map((rv) => ({ id: rv.id, name: rv.name, type: rv.type })),
    }));
    out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(out);
  }));

  app.post('/api/reviews', wrap(async (req, res) => {
    const id = `rev_${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();
    const review = { ...req.body, id, rev: 1, createdAt: now, updatedAt: now };
    await store.createReview(review);
    res.status(201).json(review);
  }));

  // Returns the shared review plus every reviewer's decision file under `decisions`.
  app.get('/api/reviews/:id', wrap(async (req, res) => res.json(await store.getReview(safeId(req.params.id)))));

  // Full-document save with optimistic concurrency (prevents two people or tabs overwriting each other).
  app.put('/api/reviews/:id', wrap(async (req, res) => {
    const { decisions: _d, ...shared } = req.body;
    const out = await store.saveReview(safeId(req.params.id), shared, req.body.rev);
    if (out.conflict) return res.status(409).json({ error: 'conflict', serverRev: out.serverRev });
    res.json(out);
  }));

  // One reviewer's decisions. rev 0 = does not exist yet (new reviewer or imported file).
  app.put('/api/reviews/:id/decisions/:rid', wrap(async (req, res) => {
    const out = await store.saveDecisions(safeId(req.params.id), safeId(req.params.rid), req.body, req.body.rev || 0);
    if (out.conflict) return res.status(409).json({ error: 'conflict', serverRev: out.serverRev });
    res.json(out);
  }));

  // Removing a reviewer moves their decisions to the trash (never hard-deleted).
  app.delete('/api/reviews/:id/decisions/:rid', wrap(async (req, res) => {
    await store.trashDecisions(safeId(req.params.id), safeId(req.params.rid));
    res.status(204).end();
  }));

  app.delete('/api/reviews/:id', wrap(async (req, res) => {
    await store.trashReview(safeId(req.params.id));
    res.status(204).end();
  }));

  // ---- agent reasoning logs ----------------------------------------------------
  // Written append-only by agent reviewers (see CLAUDE.md); returned parsed, so the UI can show the reasoning.
  app.get('/api/reviews/:id/agent-logs/:rid', wrap(async (req, res) => {
    res.json(parseAgentLogs(await store.agentLogFiles(safeId(req.params.id), safeId(req.params.rid))));
  }));

  // ---- files -----------------------------------------------------------------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

  // Raw export files from database searches (kept verbatim for reproducibility).
  app.post('/api/reviews/:id/imports', upload.single('file'), wrap(async (req, res) => {
    const storedAs = `${Date.now()}-${cleanFileName(req.file.originalname)}`;
    await store.putFile(safeId(req.params.id), 'imports', storedAs, req.file.buffer);
    res.status(201).json({ storedAs, size: req.file.size });
  }));

  app.get('/api/reviews/:id/imports/:name', wrap(async (req, res) => {
    await store.sendFile(res, safeId(req.params.id), 'imports', path.basename(req.params.name), { download: true });
  }));

  app.post('/api/reviews/:id/pdfs/:recordId', upload.single('file'), wrap(async (req, res) => {
    if (req.file.buffer.subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'not a PDF' });
    const storedAs = `${safeId(req.params.recordId)}.pdf`;
    await store.putFile(safeId(req.params.id), 'pdfs', storedAs, req.file.buffer);
    res.status(201).json({ storedAs, size: req.file.size, originalName: req.file.originalname });
  }));

  app.get('/api/reviews/:id/pdfs/:recordId', wrap(async (req, res) => {
    await store.sendFile(res, safeId(req.params.id), 'pdfs', `${safeId(req.params.recordId)}.pdf`, { type: 'application/pdf' });
  }));

  app.delete('/api/reviews/:id/pdfs/:recordId', wrap(async (req, res) => {
    await store.deleteFile(safeId(req.params.id), 'pdfs', `${safeId(req.params.recordId)}.pdf`);
    res.status(204).end();
  }));

  // Hosted only: hands the browser a short-lived token to upload one file straight into Blob storage.
  // Only reviews/<existing review>/pdfs/<record>.pdf and reviews/<existing review>/imports/<name> are allowed.
  if (store.kind === 'cloud') {
    app.post('/api/blob-upload', wrap(async (req, res) => {
      const { handleUpload } = await import('@vercel/blob/client');
      const out = await handleUpload({
        request: req,
        body: req.body,
        onBeforeGenerateToken: async (pathname) => {
          const m = /^reviews\/([a-zA-Z0-9_-]+)\/(pdfs\/[a-zA-Z0-9_-]+\.pdf|imports\/[a-zA-Z0-9._-]+)$/.exec(pathname);
          if (!m) throw httpError(400, 'upload path not allowed');
          await store.getReview(m[1]);
          const pdf = m[2].startsWith('pdfs/');
          return {
            maximumSizeInBytes: MAX_FILE_BYTES,
            allowOverwrite: pdf,
            addRandomSuffix: false,
            ...(pdf ? { allowedContentTypes: ['application/pdf'] } : {}),
          };
        },
      });
      res.json(out);
    }));
  }

  return app;
}

// Must be registered after any static/SPA routes the caller adds.
export function installErrorHandler(app) {
  app.use((err, _req, res, _next) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  });
}
