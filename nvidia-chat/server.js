// Simple standalone NVIDIA NIM chat. No dependencies. Run: node nvidia-chat/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4321;
const MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
const BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';

// API key: env var, or read from the project's .env.local
function readKey() {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.trim().startsWith('NVIDIA_API_KEY='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {}
  return '';
}
const API_KEY = readKey();

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (req.method === 'GET' && req.url === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        if (!API_KEY) throw new Error('NVIDIA_API_KEY missing (env or .env.local)');
        const { messages } = JSON.parse(body || '{}');
        if (!Array.isArray(messages) || messages.length === 0) throw new Error('messages required');

        const upstream = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 2048,
            stream: false,
          }),
        });

        const text = await upstream.text();
        if (!upstream.ok) {
          res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `NVIDIA ${upstream.status}: ${text.slice(0, 800)}` }));
        }

        const data = JSON.parse(text);
        const msg = data.choices?.[0]?.message || {};
        const reply = (msg.content || '').trim() || (msg.reasoning_content || '').trim();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: reply || '(empty response)', model: data.model || MODEL }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  NVIDIA chat running:  http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  API key: ${API_KEY ? 'loaded' : 'MISSING — set NVIDIA_API_KEY'}\n`);
});
