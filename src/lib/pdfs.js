import { api } from './api.js';
import { normTitle } from './dedup.js';

const base = (p) => (p || '').split(/[\\/]/).pop().toLowerCase();

// Match a PDF file to a record: Zotero/Mendeley file path → DOI in filename → title in filename.
export function matchPdf(file, records) {
  const name = file.name.toLowerCase();
  const byHint = records.find((r) => r.pdfHint && base(r.pdfHint) === name);
  if (byHint) return { record: byHint, by: 'export file path' };
  const flat = name.replace(/[^a-z0-9]/g, '');
  const byDoi = records.find((r) => r.doi && flat.includes(r.doi.replace(/[^a-z0-9]/g, '')));
  if (byDoi) return { record: byDoi, by: 'DOI' };
  const byTitle = records.filter((r) => {
    const t = normTitle(r.title).slice(0, 30);
    return t.length >= 20 && flat.includes(t);
  });
  if (byTitle.length === 1) return { record: byTitle[0], by: 'title' };
  return null;
}

export async function attachPdf(reviewId, recordId, file, update) {
  const res = await api.uploadPdf(reviewId, recordId, file);
  await update((r) => ({
    ...r,
    records: r.records.map((x) =>
      x.id === recordId ? { ...x, pdf: { originalName: file.name, size: res.size, uploadedAt: new Date().toISOString() } } : x),
  }), { immediate: true });
}

export async function detachPdf(reviewId, recordId, update) {
  await api.deletePdf(reviewId, recordId);
  await update((r) => ({ ...r, records: r.records.map((x) => (x.id === recordId ? { ...x, pdf: null } : x)) }), { immediate: true });
}
