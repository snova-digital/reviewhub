"""Build paper figures from a ReviewHub paper-data.json.

Usage:
    pip install matplotlib
    python figures.py path/to/paper-data.json [output-folder]

Writes PNG + SVG figures and a prisma.md with the numbers for the flow diagram.
Every figure uses FINAL values only (consensus, or agreement of the human reviewers),
so the figures always match the PRISMA counts and the text.

Adapt freely: this is a starting point, not a fixed style.
"""
import json
import sys
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt

src = Path(sys.argv[1] if len(sys.argv) > 1 else "paper-data.json")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "figures")
out.mkdir(parents=True, exist_ok=True)
data = json.loads(src.read_text(encoding="utf-8"))

included = data["included"]
codes = {c["id"]: c for c in data.get("codebook", [])}

# Unresolved coding conflicts have no agreed codes yet: leave them out of code figures and say so.
unresolved = [s for s in included if s.get("codingStatus") == "conflict"]
if unresolved:
    print(f"warning: {len(unresolved)} included source(s) have unresolved coding conflicts and are left out of the code figures")
coded = [s for s in included if s.get("codingStatus") not in ("conflict", "pending")]
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})


def save(fig, name):
    fig.tight_layout()
    for ext in ("png", "svg"):
        fig.savefig(out / f"{name}.{ext}", dpi=300)
    plt.close(fig)
    print(f"wrote {out / name}.png/.svg")


# --- PRISMA numbers -------------------------------------------------------------
p = data["prisma"]
lines = [
    f"# PRISMA flow: {data['review']['title']}",
    "",
    f"- Records identified: {p['identified']}",
    *[f"  - {d['database']}: {d['imported']}" for d in p.get("perDatabase", [])],
    f"- Duplicates removed: {p['duplicates']}",
    f"- Records screened (title/abstract): {p.get('unique', p['identified'] - p['duplicates'])}",
    f"- Records excluded: {p['taExcluded']}",
    f"- Reports sought for retrieval: {p['sought']}",
    f"- Reports not retrieved: {p['notRetrieved']}",
    f"- Reports assessed for eligibility: {p['assessed']}",
    f"- Reports excluded: {p['ftExcluded']}",
    *[f"  - {reason}: {n}" for reason, n in p.get("reasons", [])],
    f"- Sources included: {p['ftIncluded']}",
]
(out / "prisma.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out / 'prisma.md'}")

# --- Sources per year ------------------------------------------------------------
years = Counter(int(s["year"]) for s in included if str(s.get("year", "")).isdigit())
if years:
    xs = list(range(min(years), max(years) + 1))
    fig, ax = plt.subplots(figsize=(6, 3))
    ax.bar(xs, [years.get(x, 0) for x in xs], color="#4eacb8")
    ax.set_xlabel("Publication year")
    ax.set_ylabel("Included sources")
    ax.set_xticks(xs)
    ax.tick_params(axis="x", rotation=45)
    save(fig, "sources-per-year")

# --- Codes per group (how many sources carry each code) -------------------------
code_counts = Counter(cid for s in coded for cid in set(s.get("codes", [])))
if code_counts:
    rows = sorted(code_counts.items(), key=lambda kv: (codes.get(kv[0], {}).get("group", ""), -kv[1]))
    labels = [f"{codes.get(cid, {}).get('group', '')} · {codes.get(cid, {}).get('label', cid)}" for cid, _ in rows]
    fig, ax = plt.subplots(figsize=(7, 0.3 * len(rows) + 1))
    ax.barh(labels, [n for _, n in rows], color="#9b84d4")
    ax.invert_yaxis()
    ax.set_xlabel("Included sources")
    save(fig, "codes")

# --- Evidence map: codes x publication year --------------------------------------
if code_counts and years:
    top = [cid for cid, _ in code_counts.most_common(20)]
    xs = sorted(years)
    grid = [[sum(1 for s in coded if cid in s.get("codes", []) and str(s.get("year")) == str(y)) for y in xs] for cid in top]
    fig, ax = plt.subplots(figsize=(0.45 * len(xs) + 3, 0.35 * len(top) + 1))
    im = ax.imshow(grid, cmap="Blues", aspect="auto")
    ax.set_xticks(range(len(xs)))
    ax.set_xticklabels(xs, rotation=45)
    ax.set_yticks(range(len(top)))
    ax.set_yticklabels([codes.get(cid, {}).get("label", cid) for cid in top])
    peak = max(max(row) for row in grid) or 1
    for i, row in enumerate(grid):
        for j, n in enumerate(row):
            if n:
                ax.text(j, i, n, ha="center", va="center", fontsize=8, color="white" if n > peak / 2 else "black")
    fig.colorbar(im, ax=ax, label="Sources")
    save(fig, "evidence-map-codes-by-year")

# --- Agreement table for the methods section -------------------------------------
agreement = data.get("agreement", {})
pct = lambda v: "n/a" if v is None else f"{v:.0%}"
num = lambda v: "n/a" if v is None else f"{v:.2f}"
rows = ["| Stage | Reviewers | n | Agreement | Cohen's κ |", "|---|---|---|---|---|"]
stages = [("Title/abstract", agreement.get("ta")), ("Full text", agreement.get("ft")),
          ("Calibration T/A", (agreement.get("calibration") or {}).get("ta")),
          ("Calibration full text", (agreement.get("calibration") or {}).get("ft")),
          ("Critical appraisal", agreement.get("appraisal"))]
for label, pairs in stages:
    for a in pairs or []:
        rows.append(f"| {label} | {a['a']} / {a['b']} | {a['n']} | {pct(a.get('percentAgreement'))} | {num(a.get('kappa'))} |")
for a in agreement.get("coding") or []:  # coding: identical code sets and mean κ per code
    rows.append(f"| Coding | {a['a']} / {a['b']} | {a['n']} | {pct(a.get('identicalCodeSets'))} identical | {num(a.get('meanKappaPerCode'))} (mean per code) |")
(out / "agreement.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
print(f"wrote {out / 'agreement.md'}")
