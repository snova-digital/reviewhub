// Vercel entry point: the ReviewHub API backed by Neon Postgres + private Vercel Blob, behind the shared password
// (REVIEWHUB_PASSWORD). vercel.json rewrites every /api/* request here; the front end is served as static files from dist/.
import { createApp, installErrorHandler } from '../server/app.js';
import { createCloudStore } from '../server/store-cloud.js';

const app = createApp(createCloudStore(), { authRequired: true });
installErrorHandler(app);

export default app;
