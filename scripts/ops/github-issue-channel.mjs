// GitHub-issue alert channel (D68): every alert is an issue labelled `ops-alert`, assigned
// to the PM so GitHub emails them; resolving comments and closes it. Implements the
// channel contract used by health-monitor.mjs: listOpen() + apply(action).

const ALERT_LABEL = 'ops-alert';
const LABEL_COLORS = { [ALERT_LABEL]: 'b60205', critical: 'd93f0b', warning: 'fbca04', env: '1d76db' };

function restClient(repo, token) {
  return async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
}

/**
 * @param {{repo:string, token:string, env:string, assignee?:string, call?:Function}} options
 * `call(path, init)` defaults to the GitHub REST client; tests inject a fake.
 */
export function githubIssueChannel({ repo, token, env, assignee, call = restClient(repo, token) }) {
  const send = (path, method, payload) => call(path, { method, body: JSON.stringify(payload) });
  const labelsFor = (severity) => [ALERT_LABEL, `ops:${env}`, `ops:${severity}`];

  // Creating an issue with an unknown label fails, so make sure each label exists once.
  const ensured = new Set();
  async function ensureLabels(names) {
    for (const name of names) {
      if (ensured.has(name)) continue;
      if (!(await call(`/labels/${encodeURIComponent(name)}`))) {
        const kind = name === ALERT_LABEL ? ALERT_LABEL : name.replace(/^ops:/, '');
        await send('/labels', 'POST', { name, color: LABEL_COLORS[kind] ?? LABEL_COLORS.env });
      }
      ensured.add(name);
    }
  }

  return {
    name: 'github-issue',

    async listOpen() {
      const open = [];
      for (let page = 1; page <= 5; page++) {
        const batch = (await call(`/issues?state=open&labels=${ALERT_LABEL}&per_page=100&page=${page}`)) ?? [];
        open.push(...batch.filter((i) => !i.pull_request).map((i) => ({ id: i.number, body: i.body ?? '' })));
        if (batch.length < 100) break;
      }
      return open;
    },

    async apply(action) {
      if (action.type === 'open') {
        const labels = labelsFor(action.alert.severity);
        await ensureLabels(labels);
        const issue = await send('/issues', 'POST', {
          title: action.alert.title,
          body: action.alert.body,
          labels,
          assignees: assignee ? [assignee] : [],
        });
        return `opened #${issue.number}`;
      }
      if (action.type === 'update') {
        await send(`/issues/${action.alertId}`, 'PATCH', { title: action.alert.title, body: action.alert.body });
        return `updated #${action.alertId}`;
      }
      await send(`/issues/${action.alertId}/comments`, 'POST', {
        body: `Resolved automatically: ${action.reason} (${new Date().toISOString()}).`,
      });
      await send(`/issues/${action.alertId}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
      return `resolved #${action.alertId}`;
    },
  };
}
