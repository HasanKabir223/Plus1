<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Data Integrity & Zero-Metric Invariant
- **Never synthesize, mock, or hardcode fake metrics**: Never invent baseline numbers, string-hashing algorithms, or random generators for user counts, followers, following, views, likes, or activity metrics.
- **Strict reality grounding**: If an entity or user has zero records or if backing tables do not exist, strictly display `0` (or omit the metric). Never fabricate platform engagement or statistics to populate UI cards.

