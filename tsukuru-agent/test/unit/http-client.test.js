const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  requestBuffer,
  requestData,
  requestJson,
} = require('../../.build/app/src/core/httpClient.js');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('HTTP client permits only explicit loopback HTTP and parses bounded JSON', async () => {
  await withServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true }));
  }, async (base) => {
    const response = await requestJson(`${base}/value`, {
      allowHttpLoopback: true,
      timeoutMs: 1000,
      maxBytes: 1024,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { ok: true });
    await assert.rejects(() => requestJson(`${base}/value`, { timeoutMs: 1000, maxBytes: 1024 }), /HTTPS|loopback/i);
  });
});

test('HTTP client rejects redirects, oversized bodies, and timeouts', async () => {
  await withServer((request, response) => {
    if (request.url === '/redirect') {
      response.statusCode = 302;
      response.setHeader('location', '/target');
      response.end();
      return;
    }
    if (request.url === '/slow') {
      setTimeout(() => response.end('late'), 100);
      return;
    }
    response.end('x'.repeat(32));
  }, async (base) => {
    await assert.rejects(
      () => requestBuffer(`${base}/redirect`, { allowHttpLoopback: true, timeoutMs: 1000, maxBytes: 1024 }),
      /redirect/i,
    );
    await assert.rejects(
      () => requestBuffer(`${base}/large`, { allowHttpLoopback: true, timeoutMs: 1000, maxBytes: 8 }),
      /size|large|bytes/i,
    );
    await assert.rejects(
      () => requestData(`${base}/slow`, { allowHttpLoopback: true, timeoutMs: 20, maxBytes: 1024 }),
      /timeout/i,
    );
  });
});

test('HTTP client follows only an explicitly bounded redirect host allowlist', async () => {
  await withServer((request, response) => {
    if (request.url === '/redirect') {
      response.statusCode = 302;
      response.setHeader('location', '/target');
      response.end();
      return;
    }
    response.end('ok');
  }, async (base) => {
    const response = await requestBuffer(`${base}/redirect`, {
      allowHttpLoopback: true,
      timeoutMs: 1000,
      maxBytes: 1024,
      maxRedirects: 1,
      allowedRedirectHosts: ['127.0.0.1'],
    });
    assert.equal(response.data.toString('utf8'), 'ok');
    await assert.rejects(() => requestBuffer(`${base}/redirect`, {
      allowHttpLoopback: true,
      timeoutMs: 1000,
      maxBytes: 1024,
      maxRedirects: 1,
      allowedRedirectHosts: ['example.com'],
    }), /host is not allowed/i);
  });
});

test('HTTP client encodes GET query values and POST form bodies without redirects', async () => {
  await withServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ url: request.url, method: request.method, body: Buffer.concat(chunks).toString('utf8') }));
  }, async (base) => {
    const get = await requestJson(`${base}/query`, {
      allowHttpLoopback: true,
      timeoutMs: 1000,
      maxBytes: 2048,
      query: { text: 'a b' },
    });
    assert.match(get.data.url, /text=a\+b/);
    const post = await requestJson(`${base}/form`, {
      allowHttpLoopback: true,
      timeoutMs: 1000,
      maxBytes: 2048,
      method: 'POST',
      form: { q: '안녕', target: 'ko' },
    });
    assert.equal(post.data.method, 'POST');
    assert.match(post.data.body, /target=ko/);
  });
});
