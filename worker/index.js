// Cloudflare Worker in front of the static dashboard.
//  - serves site/ (static assets)
//  - POST /api/sync   -> starts the "Garmin sync" GitHub Actions workflow
//  - GET  /api/status -> state of the latest workflow run
//  - cron trigger     -> starts the workflow every morning (GitHub's own schedule is often hours late)
// The whole hostname is behind Cloudflare Access, so only you can reach /api/*.
// Needs one secret on the Worker: GITHUB_TOKEN (fine-grained token, repo garmin, "Actions: Read and write").

const REPO = "eliran-hue/garmin";
const WORKFLOW = "garmin-sync.yml";

async function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "garmin-dashboard",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function latestRun(env) {
  const r = await gh(env, `/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  if (!r.ok) return { error: `GitHub ${r.status}` };
  const run = (await r.json()).workflow_runs?.[0];
  if (!run) return { status: "none" };
  return { id: run.id, status: run.status, conclusion: run.conclusion, event: run.event,
           created_at: run.created_at, updated_at: run.updated_at, url: run.html_url };
}

async function dispatch(env, days = "7") {
  const r = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST", body: JSON.stringify({ ref: "main", inputs: { days: String(days) } }),
  });
  return r.status === 204 ? { ok: true } : { ok: false, error: `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}` };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN secret is not set on the Worker" }, 500);
      if (url.pathname === "/api/status" && request.method === "GET") return json(await latestRun(env));
      if (url.pathname === "/api/sync" && request.method === "POST") {
        const cur = await latestRun(env);
        if (cur.status === "queued" || cur.status === "in_progress") return json({ ok: true, already: true, run: cur });
        const res = await dispatch(env, "7");
        return json(res, res.ok ? 202 : 502);
      }
      return json({ error: "not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (env.GITHUB_TOKEN) ctx.waitUntil(dispatch(env, "7"));
  },
};
