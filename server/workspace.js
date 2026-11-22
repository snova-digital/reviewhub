// Where ReviewHub keeps its data (the "workspace"). Shared by the API server and the CLI (scripts/rh.mjs).
//
// Resolution order:
//   1. REVIEWHUB_WORKSPACE environment variable
//   2. "workspace" in reviewhub.config.json next to package.json (relative paths and ~ allowed)
//   3. REVIEWHUB_DATA environment variable (legacy: points at the reviews folder itself)
//   4. ./data, if it already holds reviews (installations from before the workspace existed)
//   5. ./workspace (default for new installations; gitignored)
//
// Layout inside a workspace:
//   reviews/<reviewId>/...   one folder per review (see README)
//   trash/                   deleted reviews and removed reviewer files, never hard-deleted
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// REVIEWHUB_CONFIG points at another config file (e.g. for tests), so a test never rewrites the real one.
export const CONFIG_FILE = process.env.REVIEWHUB_CONFIG ? path.resolve(process.env.REVIEWHUB_CONFIG) : path.join(ROOT, 'reviewhub.config.json');

export const expand = (p) => path.resolve(ROOT, p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

export function resolveWorkspace() {
  const cfg = readConfig();
  if (process.env.REVIEWHUB_WORKSPACE) return layout(expand(process.env.REVIEWHUB_WORKSPACE), 'REVIEWHUB_WORKSPACE');
  if (cfg.workspace) return layout(expand(cfg.workspace), 'reviewhub.config.json');
  if (process.env.REVIEWHUB_DATA) {
    const reviews = expand(process.env.REVIEWHUB_DATA);
    return { workspace: path.dirname(reviews), reviews, trash: path.join(path.dirname(reviews), 'trash'), source: 'REVIEWHUB_DATA' };
  }
  const legacy = path.join(ROOT, 'data');
  if (fs.existsSync(path.join(legacy, 'reviews'))) return layout(legacy, 'default (./data)');
  return layout(path.join(ROOT, 'workspace'), 'default (./workspace)');
}

function layout(workspace, source) {
  return { workspace, reviews: path.join(workspace, 'reviews'), trash: path.join(workspace, 'trash'), source };
}
