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
