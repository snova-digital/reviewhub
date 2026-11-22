export const httpError = (status, message) => Object.assign(new Error(message), { status });

export const safeId = (id) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) throw httpError(400, 'bad id');
  return id;
};

// Raw import files are stored under a cleaned name.
export const cleanFileName = (name) => String(name).replace(/[^a-zA-Z0-9._-]/g, '_');

// Agent log files ([{ file, text }]) → runs as the UI expects them.
export function parseAgentLogs(files) {
  return files.map(({ file, text }) => {
    const entries = [];
    for (const l of text.split('\n').filter((x) => x.trim())) {
      try { entries.push(JSON.parse(l)); } catch { entries.push({ type: 'unparseable', raw: l.slice(0, 200) }); }
    }
    return { file, header: entries.find((e) => e.type === 'run') || null, entries: entries.filter((e) => e.type !== 'run') };
  });
}
