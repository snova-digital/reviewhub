// HTTP client for the ReviewHub API. Works against both the local server (files on disk) and the hosted version
// (Neon + Vercel Blob, behind a shared password): GET /api/info tells which one it is.
const GZIP_OVER = 1024 * 1024; // gzip JSON bodies above 1 MB (hosted requests are limited to 4.5 MB)

export const AUTH_EVENT = 'reviewhub:auth-required';
export const SIGNED_IN_EVENT = 'reviewhub:signed-in';

async function jsonBody(body) {
  const text = JSON.stringify(body);
  if (text.length < GZIP_OVER || typeof CompressionStream === 'undefined') return { text, headers: { 'Content-Type': 'application/json' } };
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { text: gz, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } };
}

async function req(method, url, body) {
  let headers; let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) ({ text: payload, headers } = await jsonBody(body));
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  if (!res.ok) {
    const err = new Error(`${method} ${url} → ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && err.body?.error === 'auth') window.dispatchEvent(new Event(AUTH_EVENT));
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const form = (file) => { const f = new FormData(); f.append('file', file); return f; };

let infoPromise = null;
const info = () => {
  infoPromise ||= req('GET', '/api/info').catch((e) => { infoPromise = null; throw e; });
  return infoPromise;
};
const isCloud = async () => (await info()).storage === 'cloud';

// Hosted: the browser uploads the file straight into Blob storage (no 4.5 MB request limit).
async function blobUpload(pathname, file, contentType) {
  const { upload } = await import('@vercel/blob/client');
  await upload(pathname, file, {
    access: 'private',
    handleUploadUrl: '/api/blob-upload',
    contentType,
    multipart: file.size > 8 * 1024 * 1024,
  });
}

const cleanFileName = (name) => String(name).replace(/[^a-zA-Z0-9._-]/g, '_');

export const api = {
  info,
  session: () => req('GET', '/api/session'),
  login: (password) => req('POST', '/api/login', { password }),
  logout: () => req('POST', '/api/logout', {}),
  setWorkspace: (path, copy) => req('PUT', '/api/workspace', { path, copy }),
  listReviews: () => req('GET', '/api/reviews'),
  agentLogs: (id, rid) => req('GET', `/api/reviews/${id}/agent-logs/${rid}`),
  createReview: (r) => req('POST', '/api/reviews', r),
  getReview: (id) => req('GET', `/api/reviews/${id}`),
  saveReview: (r) => req('PUT', `/api/reviews/${r.id}`, r),
  deleteReview: (id) => req('DELETE', `/api/reviews/${id}`),
  saveDecisions: (id, rid, d) => req('PUT', `/api/reviews/${id}/decisions/${rid}`, d),
  deleteDecisions: (id, rid) => req('DELETE', `/api/reviews/${id}/decisions/${rid}`),
  async uploadImport(id, file) {
    if (!(await isCloud())) return req('POST', `/api/reviews/${id}/imports`, form(file));
    const storedAs = `${Date.now()}-${cleanFileName(file.name)}`;
    await blobUpload(`reviews/${id}/imports/${storedAs}`, file, file.type || 'application/octet-stream');
    return { storedAs, size: file.size };
  },
  importUrl: (id, name) => `/api/reviews/${id}/imports/${encodeURIComponent(name)}`,
  async uploadPdf(id, recordId, file) {
    if (!(await isCloud())) return req('POST', `/api/reviews/${id}/pdfs/${recordId}`, form(file));
    const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (head !== '%PDF-') throw Object.assign(new Error('not a PDF'), { status: 400, body: { error: 'not a PDF' } });
    await blobUpload(`reviews/${id}/pdfs/${recordId}.pdf`, file, 'application/pdf');
    return { storedAs: `${recordId}.pdf`, size: file.size, originalName: file.name };
  },
  deletePdf: (id, recordId) => req('DELETE', `/api/reviews/${id}/pdfs/${recordId}`),
  pdfUrl: (id, recordId, v) => `/api/reviews/${id}/pdfs/${recordId}${v ? `?v=${v}` : ''}`,
};
