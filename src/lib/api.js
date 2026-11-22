async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`${method} ${url} → ${res.status}`);
    err.status = res.status;
    try { err.body = await res.json(); } catch { /* empty */ }
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const form = (file) => { const f = new FormData(); f.append('file', file); return f; };

export const api = {
  info: () => req('GET', '/api/info'),
  setWorkspace: (path, copy) => req('PUT', '/api/workspace', { path, copy }),
  listReviews: () => req('GET', '/api/reviews'),
  agentLogs: (id, rid) => req('GET', `/api/reviews/${id}/agent-logs/${rid}`),
  createReview: (r) => req('POST', '/api/reviews', r),
  getReview: (id) => req('GET', `/api/reviews/${id}`),
  saveReview: (r) => req('PUT', `/api/reviews/${r.id}`, r),
  deleteReview: (id) => req('DELETE', `/api/reviews/${id}`),
  saveDecisions: (id, rid, d) => req('PUT', `/api/reviews/${id}/decisions/${rid}`, d),
  deleteDecisions: (id, rid) => req('DELETE', `/api/reviews/${id}/decisions/${rid}`),
  uploadImport: (id, file) => req('POST', `/api/reviews/${id}/imports`, form(file)),
  importUrl: (id, name) => `/api/reviews/${id}/imports/${encodeURIComponent(name)}`,
  uploadPdf: (id, recordId, file) => req('POST', `/api/reviews/${id}/pdfs/${recordId}`, form(file)),
  deletePdf: (id, recordId) => req('DELETE', `/api/reviews/${id}/pdfs/${recordId}`),
  pdfUrl: (id, recordId, v) => `/api/reviews/${id}/pdfs/${recordId}${v ? `?v=${v}` : ''}`,
};
