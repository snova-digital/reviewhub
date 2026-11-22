// ReviewHub local API. By default it stores reviews as JSON files in the workspace (see store-fs.js).
// REVIEWHUB_STORAGE=cloud runs the same API against the hosted database instead (needs .env.local from `vercel env pull`);
// that is mainly for testing the hosted setup locally.
import express from 'express';
import fsSync from 'node:fs';
import path from 'node:path';
import { createApp, installErrorHandler } from './app.js';
import { ROOT } from './workspace.js';

const cloud = process.env.REVIEWHUB_STORAGE === 'cloud';
if (cloud && fsSync.existsSync(path.join(ROOT, '.env.local'))) process.loadEnvFile(path.join(ROOT, '.env.local'));

const store = cloud
  ? (await import('./store-cloud.js')).createCloudStore()
  : await (await import('./store-fs.js')).createFsStore();

const PORT = Number(process.env.PORT || 5288);
// Local tool without logins: only reachable from this computer unless HOST is set explicitly (e.g. HOST=0.0.0.0).
// Set REVIEWHUB_PASSWORD to require the shared password here too.
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp(store, { authRequired: cloud });

// ---- production static -----------------------------------------------------
const dist = path.join(ROOT, 'dist');
if (fsSync.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
installErrorHandler(app);

const where = store.info();
app.listen(PORT, HOST, () => console.log(`ReviewHub API on http://${HOST}:${PORT}\n  ${cloud ? 'storage' : 'workspace'}: ${where.workspace}  [${where.source}]`))
  .on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use: ReviewHub is probably already running in another terminal.\nStop it there, or find the process with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
      process.exit(1);
    }
    throw e;
  });
