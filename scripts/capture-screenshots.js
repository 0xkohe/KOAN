// Run with playwright-cli run-code --filename=scripts/capture-screenshots.js.
// API and WebSocket responses are fictional; no Gateway or agent is contacted.
async (page) => {
  const baseURL = 'http://127.0.0.1:5174';
  const timestamp = '2026-01-15T10:00:00.000Z';
  const projects = [
    { id: 'atlas', name: 'Atlas', path: '/workspace/atlas' },
    { id: 'notebook', name: 'Notebook', path: '/workspace/notebook' },
    { id: 'website', name: 'Personal website', path: '/workspace/website' },
  ].map(project => ({ ...project, createdAt: timestamp, updatedAt: timestamp }));
  const sessions = [
    { id: 'search', projectId: 'atlas', projectName: 'Atlas', agentId: 'codex', title: 'Add keyboard shortcuts', status: 'idle' },
    { id: 'approval', projectId: 'atlas', projectName: 'Atlas', agentId: 'claude', title: 'Polish the search experience', status: 'waiting_approval' },
    { id: 'notes', projectId: 'notebook', projectName: 'Notebook', agentId: 'opencode', title: 'Build a Markdown preview', status: 'running' },
    { id: 'landing', projectId: 'website', projectName: 'Personal website', agentId: 'kiro', title: 'Review the landing page', status: 'idle' },
  ].map(session => ({ ...session, model: null, mode: null, createdAt: timestamp, updatedAt: timestamp, lastSeq: 5, unread: 0 }));
  const agents = ['codex', 'claude', 'kiro', 'cline', 'opencode'].map(id => ({
    id, label: { codex: 'Codex', claude: 'Claude', kiro: 'Kiro', cline: 'Cline', opencode: 'OpenCode' }[id],
    available: true, version: 'Demo', reason: null,
    capabilities: { approvals: true, attachments: true, resume: true, models: true },
  }));
  const event = (sessionId, seq, type, payload) => ({ sessionId, seq, type, payload: { turnId: 'demo-turn', ...payload }, createdAt: timestamp });
  const approval = {
    id: 'demo-approval', sessionId: 'approval', turnId: 'demo-turn',
    title: 'Run the search tests?', description: 'The agent wants to verify the changes before continuing.',
    command: 'pnpm test -- search', status: 'pending', createdAt: timestamp,
    options: [{ id: 'deny', label: 'Deny', kind: 'deny' }, { id: 'allow', label: 'Approve once', kind: 'allow' }],
  };
  const conversation = [
    event('search', 1, 'message.user', { text: 'Add a keyboard shortcut to open search. Make it work on Mac and Windows.' }),
    event('search', 2, 'tool.completed', { id: 'read', title: 'Read the search component', command: 'src/components/search.tsx', status: 'completed' }),
    event('search', 3, 'tool.completed', { id: 'test', title: 'Run keyboard interaction tests', command: 'pnpm test -- search', status: 'completed' }),
    event('search', 4, 'message.assistant.delta', { text: 'Added **⌘K** on Mac and **Ctrl+K** on Windows.\n\n- Focus moves into the search field.\n- **Escape** closes the dialog.\n- The shortcut hint appears in the toolbar.\n\nAll 8 search tests pass. You can review the changes in the diff viewer.' }),
    event('search', 5, 'message.assistant.completed', {}),
  ];
  const approvalEvents = [
    event('approval', 1, 'message.user', { text: 'Improve the empty state and make search easier to use on mobile.' }),
    event('approval', 2, 'tool.completed', { id: 'read', title: 'Inspect the search UI', command: 'src/components/search.tsx', status: 'completed' }),
    event('approval', 3, 'message.assistant.delta', { text: 'I updated the empty state with a helpful suggestion and increased the touch targets. I would like to run the search tests to check the interaction.' }),
    event('approval', 4, 'message.assistant.completed', {}),
    event('approval', 5, 'session.status', { status: 'waiting_approval' }),
  ];
  await page.addInitScript(() => {
    localStorage.setItem('koan-locale', 'en');
    localStorage.setItem('koan-theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      '/api/v1/auth/status': { paired: true, device: { id: 'demo-device', name: 'Demo phone' } },
      '/api/v1/projects': { projects }, '/api/v1/sessions': { sessions }, '/api/v1/agents': { agents },
      '/api/v1/roots': { roots: ['/workspace'], defaultPath: '/workspace' },
      '/api/v1/directories': { path: '/workspace', parent: null, truncated: false, directories: projects.map(p => ({ name: p.path.split('/').pop(), path: p.path })) },
      '/api/v1/sessions/search': { session: sessions[0], events: conversation, hasMoreEvents: false, approvals: [], questions: [] },
      '/api/v1/sessions/approval': { session: sessions[1], events: approvalEvents, hasMoreEvents: false, approvals: [approval], questions: [] },
    };
    if (!(path in responses)) throw new Error(`Unmocked screenshot request: ${path}`);
    await route.fulfill({ json: responses[path] });
  });
  await page.routeWebSocket('ws://127.0.0.1:5174/ws', socket => {
    socket.send(JSON.stringify({ type: 'ready', serverTime: timestamp }));
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function capture(path, filename, selector) {
    await page.goto(`${baseURL}${path}`);
    await page.locator(selector).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `docs/screenshots/${filename}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture('/', 'dashboard', '.sidebar .bg-green');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('/sessions/search', 'session-mobile', '.connection-dot.online');
  await capture('/sessions/approval', 'approval-mobile', '.approval-sheet');
  await capture('/projects', 'projects-mobile', '.directory-row');
  if (errors.length) throw new Error(errors.join('\n'));
  return 'Captured four screenshots using fictional data; no browser errors.';
}
