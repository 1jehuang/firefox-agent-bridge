#!/usr/bin/env node
/**
 * Test Server for Firefox Agent Bridge Benchmarks
 *
 * Serves static test site files and provides dynamic API routes.
 * Run: node benchmarks/test-server.js
 * Default port: 3456
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.TEST_PORT || 3456;
const STATIC_DIR = path.join(__dirname, 'test-site');

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// In-memory session store (simple)
const sessions = new Map();

// Mock OAuth state store
const oauthStates = new Map();

// Mock Google accounts for OAuth simulation
const mockGoogleAccounts = [
  { id: '1', email: 'testuser@gmail.com', name: 'Test User', picture: '/avatar1.png' },
  { id: '2', email: 'work.account@gmail.com', name: 'Work Account', picture: '/avatar2.png' }
];

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

function serveStatic(req, res) {
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // Remove query string
  filePath = filePath.split('?')[0];

  // Security: prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

// Mock search data
const searchData = [
  { id: 1, title: 'Firefox Agent Bridge', description: 'Browser automation via WebSocket', category: 'tools' },
  { id: 2, title: 'Benchmark Results', description: 'Performance comparison data', category: 'data' },
  { id: 3, title: 'API Documentation', description: 'Complete API reference', category: 'docs' },
  { id: 4, title: 'Setup Guide', description: 'Getting started tutorial', category: 'docs' },
  { id: 5, title: 'WebSocket Protocol', description: 'Technical protocol specification', category: 'docs' }
];

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Routes
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const { username, password } = body;

    if (!username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Username and password required' }));
      return;
    }

    // Accept any non-empty credentials
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessions.set(sessionId, { username, loginTime: Date.now() });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly`
    });
    res.end(JSON.stringify({ success: true, username }));
    return;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const sessionId = getCookie(req, 'session');
    if (sessionId) sessions.delete(sessionId);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.pathname === '/api/protected') {
    const sessionId = getCookie(req, 'session');
    const session = sessionId ? sessions.get(sessionId) : null;

    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Welcome to protected area',
      user: session.username,
      secretData: {
        apiKey: 'sk-test-1234567890',
        accountId: 'ACC-98765',
        accessLevel: 'premium'
      }
    }));
    return;
  }

  if (url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').toLowerCase();

    if (!query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Query parameter q is required' }));
      return;
    }

    const results = searchData.filter(item =>
      item.title.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query, results, total: results.length }));
    return;
  }

  if (url.pathname === '/api/submit-contact' && req.method === 'POST') {
    const body = await parseBody(req);
    const { name, email, phone, subject, message } = body;

    if (!name || !email || !message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Name, email, and message are required' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Contact form submitted successfully',
      ticketId: `TICKET-${Date.now()}`
    }));
    return;
  }

  // Health check
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // === Mock OAuth Flow ===

  // Step 1: OAuth initiation (redirects to mock Google)
  if (url.pathname === '/oauth/google/start') {
    const state = `state_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const redirectUri = url.searchParams.get('redirect_uri') || `http://localhost:${PORT}/oauth/callback`;
    oauthStates.set(state, { redirectUri, created: Date.now() });

    // Redirect to mock Google account picker
    res.writeHead(302, { 'Location': `/oauth/google/accounts?state=${state}` });
    res.end();
    return;
  }

  // Step 2: Mock Google account picker page
  if (url.pathname === '/oauth/google/accounts') {
    const state = url.searchParams.get('state');
    if (!state || !oauthStates.has(state)) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid OAuth state</h1>');
      return;
    }

    const accountsHtml = mockGoogleAccounts.map(acc => `
      <div class="account" onclick="selectAccount('${acc.id}')">
        <img src="${acc.picture}" alt="avatar" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%234285f4%22/><text x=%2250%22 y=%2265%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>${acc.name[0]}</text></svg>'">
        <div class="account-info">
          <div class="name">${acc.name}</div>
          <div class="email">${acc.email}</div>
        </div>
      </div>
    `).join('');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sign in - Google Accounts</title>
        <style>
          body { font-family: 'Google Sans', Roboto, Arial, sans-serif; margin: 0; padding: 40px; background: #f8f9fa; }
          .container { max-width: 450px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 48px 40px; }
          .logo { text-align: center; margin-bottom: 24px; }
          .logo svg { width: 75px; }
          h1 { font-size: 24px; font-weight: 400; margin: 0 0 8px; text-align: center; }
          .subtitle { color: #5f6368; text-align: center; margin-bottom: 32px; }
          .account { display: flex; align-items: center; padding: 12px 16px; border: 1px solid #dadce0; border-radius: 8px; margin-bottom: 12px; cursor: pointer; transition: background 0.2s; }
          .account:hover { background: #f8f9fa; }
          .account img { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; }
          .account-info .name { font-weight: 500; }
          .account-info .email { color: #5f6368; font-size: 14px; }
          .use-another { text-align: center; margin-top: 24px; }
          .use-another a { color: #1a73e8; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <svg viewBox="0 0 75 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 19.5V4.5h2.8v15H0z" fill="#4285f4"/>
              <text x="8" y="19" font-size="20" font-weight="500" fill="#202124">Google</text>
            </svg>
          </div>
          <h1>Choose an account</h1>
          <p class="subtitle">to continue to Test App</p>
          ${accountsHtml}
          <div class="use-another">
            <a href="#">Use another account</a>
          </div>
        </div>
        <script>
          function selectAccount(accountId) {
            window.location.href = '/oauth/google/consent?state=${state}&account=' + accountId;
          }
        </script>
      </body>
      </html>
    `);
    return;
  }

  // Step 3: Mock Google consent screen
  if (url.pathname === '/oauth/google/consent') {
    const state = url.searchParams.get('state');
    const accountId = url.searchParams.get('account');
    const account = mockGoogleAccounts.find(a => a.id === accountId);

    if (!state || !oauthStates.has(state) || !account) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid request</h1>');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sign in - Google Accounts</title>
        <style>
          body { font-family: 'Google Sans', Roboto, Arial, sans-serif; margin: 0; padding: 40px; background: #f8f9fa; }
          .container { max-width: 450px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 48px 40px; }
          h1 { font-size: 24px; font-weight: 400; margin: 0 0 8px; }
          .account { display: flex; align-items: center; padding: 16px 0; border-bottom: 1px solid #dadce0; margin-bottom: 24px; }
          .account img { width: 32px; height: 32px; border-radius: 50%; margin-right: 12px; }
          .permissions { margin: 24px 0; }
          .permissions h3 { font-size: 14px; color: #5f6368; font-weight: 500; margin-bottom: 12px; }
          .permission { display: flex; align-items: center; padding: 8px 0; }
          .permission-icon { width: 24px; margin-right: 12px; color: #5f6368; }
          .buttons { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; }
          button { padding: 10px 24px; border-radius: 4px; font-size: 14px; cursor: pointer; }
          .cancel { background: white; border: 1px solid #dadce0; color: #1a73e8; }
          .allow { background: #1a73e8; border: none; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Test App wants to access your Google Account</h1>
          <div class="account">
            <img src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%234285f4%22/><text x=%2250%22 y=%2265%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>${account.name[0]}</text></svg>">
            <div>
              <div>${account.name}</div>
              <div style="color: #5f6368; font-size: 14px;">${account.email}</div>
            </div>
          </div>
          <div class="permissions">
            <h3>This will allow Test App to:</h3>
            <div class="permission">
              <span class="permission-icon">&#128100;</span>
              <span>See your personal info, including any personal info you've made publicly available</span>
            </div>
            <div class="permission">
              <span class="permission-icon">&#128231;</span>
              <span>See your primary Google Account email address</span>
            </div>
          </div>
          <div class="buttons">
            <button class="cancel" onclick="window.location.href='/oauth/callback?error=access_denied&state=${state}'">Cancel</button>
            <button class="allow" onclick="window.location.href='/oauth/google/authorize?state=${state}&account=${accountId}'">Allow</button>
          </div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // Step 4: Authorize and redirect back with code
  if (url.pathname === '/oauth/google/authorize') {
    const state = url.searchParams.get('state');
    const accountId = url.searchParams.get('account');
    const stateData = oauthStates.get(state);
    const account = mockGoogleAccounts.find(a => a.id === accountId);

    if (!stateData || !account) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid request</h1>');
      return;
    }

    // Generate mock auth code
    const code = `mock_code_${Date.now()}_${accountId}`;
    oauthStates.set(code, { account, created: Date.now() });
    oauthStates.delete(state);

    // Redirect back to app
    const redirectUri = stateData.redirectUri;
    res.writeHead(302, { 'Location': `${redirectUri}?code=${code}&state=${state}` });
    res.end();
    return;
  }

  // Step 5: OAuth callback (app receives code)
  if (url.pathname === '/oauth/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body>
          <h1>OAuth Error</h1>
          <p>Error: ${error}</p>
          <a href="/oauth-demo.html">Try again</a>
        </body></html>
      `);
      return;
    }

    const codeData = oauthStates.get(code);
    if (!codeData) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid authorization code</h1>');
      return;
    }

    // Create session for the OAuth user
    const account = codeData.account;
    const sessionId = `oauth_session_${Date.now()}`;
    sessions.set(sessionId, {
      username: account.email,
      name: account.name,
      loginTime: Date.now(),
      oauthProvider: 'google'
    });
    oauthStates.delete(code);

    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly`
    });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Login Successful</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
        .success { color: #0f9d58; font-size: 48px; }
        .info { margin: 24px 0; padding: 16px; background: #f8f9fa; border-radius: 8px; }
      </style>
      </head>
      <body>
        <div class="success">&#10003;</div>
        <h1>Successfully signed in with Google!</h1>
        <div class="info">
          <p><strong>Name:</strong> ${account.name}</p>
          <p><strong>Email:</strong> ${account.email}</p>
          <p><strong>Session ID:</strong> ${sessionId}</p>
        </div>
        <p><a href="/protected.html">Go to protected page</a></p>
      </body>
      </html>
    `);
    return;
  }

  // Token exchange endpoint (for apps that need access token)
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    const body = await parseBody(req);
    const { code } = body;

    const codeData = oauthStates.get(code);
    if (!codeData) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }

    oauthStates.delete(code);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: `mock_access_token_${Date.now()}`,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: `mock_id_token_${codeData.account.id}`,
      user: codeData.account
    }));
    return;
  }

  // Serve static files
  serveStatic(req, res);
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log(`Serving static files from: ${STATIC_DIR}`);
  console.log('\nAvailable pages:');
  console.log(`  http://localhost:${PORT}/           - Home`);
  console.log(`  http://localhost:${PORT}/login.html - Login form`);
  console.log(`  http://localhost:${PORT}/search.html - Search`);
  console.log(`  http://localhost:${PORT}/contact.html - Contact form`);
  console.log(`  http://localhost:${PORT}/data.html - Data table`);
  console.log(`  http://localhost:${PORT}/wizard/step1.html - Wizard`);
  console.log('\nAPI endpoints:');
  console.log(`  POST /api/login - Login (any non-empty credentials)`);
  console.log(`  POST /api/logout - Logout`);
  console.log(`  GET  /api/protected - Protected data (requires login)`);
  console.log(`  GET  /api/search?q=query - Search`);
  console.log(`  POST /api/submit-contact - Submit contact form`);
  console.log(`  GET  /api/health - Health check`);
});
