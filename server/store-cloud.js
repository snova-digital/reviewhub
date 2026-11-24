// Cloud storage for the hosted version (Vercel): JSON in Neon Postgres (cloud-db.js), PDFs and raw import files in a
// private Vercel Blob store under reviews/<reviewId>/{pdfs,imports}/<name>.
// Browsers upload files straight to Blob (client upload, see POST /api/blob-upload in app.js), because a Vercel
// Function accepts at most 4.5 MB per request; downloads redirect to a short-lived signed Blob URL for the same reason.
import { del, issueSignedToken, presignUrl } from '@vercel/blob';
import * as db from './cloud-db.js';
import { httpError, safeId } from './util.js';

export const blobPath = (id, kind, name) => `reviews/${safeId(id)}/${kind}/${name}`;

export async function signedBlobUrl(pathname, { minutes = 60 } = {}) {
  const validUntil = Date.now() + minutes * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  // useCache: false, because a PDF can be replaced under the same name.
  const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, access: 'private', validUntil, useCache: false });
  return presignedUrl;
}

export function createCloudStore() {
  async function mustExist(id) {
    const row = await db.getReviewRow(safeId(id));
    if (!row) throw httpError(404, 'not found');
    return row;
  }

  return {
    kind: 'cloud',

    info: () => ({ workspace: 'Neon Postgres + Vercel Blob (hosted)', reviews: null, source: 'cloud', configurable: false, lockedBy: 'cloud' }),

    async setWorkspace() { throw httpError(409, 'The hosted version stores reviews in the cloud database; there is no folder to choose.'); },

    async listReviews() {
      const rows = await db.listReviewSummaries();
      return rows.map((r) => ({ ...r.doc, records: { length: r.record_count } }));
    },

    async createReview(review) {
      if (!(await db.insertReview(review))) throw httpError(409, 'review id already exists');
    },

    async getReview(id) {
      const row = await mustExist(id);
      if ((row.doc.schemaVersion || 1) < 2) throw httpError(409, 'This review uses schema v1. Open it once in the local app, then push it again.');
      const decisions = {};
      for (const d of await db.getDecisionRows(id)) decisions[d.reviewer_id] = d.doc;
      return { ...row.doc, rev: row.rev, decisions };
    },

    async saveReview(id, shared, rev) {
      await mustExist(id);
      await db.maybeBackup(id);
      const next = { ...shared, id, rev: rev + 1, updatedAt: new Date().toISOString() };
      const res = await db.updateReview(id, next, rev);
      if (!res.ok) return { conflict: true, serverRev: res.serverRev };
      return { rev: next.rev, updatedAt: next.updatedAt };
    },

    async saveDecisions(id, rid, body, rev) {
      await mustExist(id);
      safeId(rid);
      await db.maybeBackup(id);
      const next = { ...body, reviewerId: rid, rev: rev + 1, updatedAt: new Date().toISOString() };
      const res = await db.putDecisions(id, rid, next, rev);
      if (!res.ok) return { conflict: true, serverRev: res.serverRev };
      return { rev: next.rev, updatedAt: next.updatedAt };
    },

    async backup(id) {
      await mustExist(id);
      await db.maybeBackup(id, true);
    },

    async trashDecisions(id, rid) {
      await db.maybeBackup(safeId(id), true);
      await db.trashDecisions(id, safeId(rid));
    },

    async trashReview(id) { await db.trashReview(safeId(id)); },

    async agentLogFiles(id, rid) {
      return (await db.getAgentLogs(safeId(id), safeId(rid))).map((r) => ({ file: r.file, text: r.body }));
    },

    async putFile() { throw httpError(400, 'In the hosted version files are uploaded directly to Blob storage.'); },

    async sendFile(res, id, kind, name) {
      await mustExist(id);
      res.redirect(302, await signedBlobUrl(blobPath(id, kind, name)));
    },

    async deleteFile(id, kind, name) {
      await del(blobPath(id, kind, name)).catch((e) => { if (e?.name !== 'BlobNotFoundError') throw e; });
    },
  };
}
