import dotenv from 'dotenv';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { BrainRequest, ImageRequest } from './contracts.js';
import {
  generateBrainResponse,
  getOpenAIKeyHint,
  getOpenAIKeySource,
  getOpenAILightModel,
  getOpenAIModel,
  isOpenAIConfigured
} from './providers/openaiBrain.js';
import {
  generateSeedreamImage,
  getSeedreamKeyHint,
  getSeedreamKeySource,
  getSeedreamMaxConcurrency,
  getSeedreamModel,
  isSeedreamConfigured
} from './providers/seedream.js';

const openAIKeyWasInProcessEnvironment = Boolean(process.env.OPENAI_API_KEY?.trim());
const localEnvResult = dotenv.config({ path: '.env.local', quiet: true });
const rootEnvResult = dotenv.config({ quiet: true });
const openAIKeyLocation = openAIKeyWasInProcessEnvironment
  ? 'process environment'
  : localEnvResult.parsed?.OPENAI_API_KEY?.trim()
    ? '.env.local'
    : rootEnvResult.parsed?.OPENAI_API_KEY?.trim()
      ? '.env'
      : null;

const port = Number(process.env.PORT || 8787);
const loopbackHost = '127.0.0.1';
const bodyLimitBytes = 50 * 1024 * 1024;
const distDirectory = resolve(process.cwd(), 'dist');
const allowedBrowserOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`
]);

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const sendJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  if (response.headersSent || response.writableEnded) return;

  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(payload);
};

const applySecurityHeaders = (response: ServerResponse) => {
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > bodyLimitBytes) throw new Error('Request body exceeds the 50 MB limit.');
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}') as T;
};

const serveFrontend = async (request: IncomingMessage, response: ServerResponse) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = resolve(distDirectory, `.${requestedPath}`);
  const isInsideDist = resolvedPath === distDirectory || resolvedPath.startsWith(`${distDirectory}${sep}`);

  if (!isInsideDist) {
    sendJson(response, 400, { error: 'Invalid path.' });
    return;
  }

  try {
    if ((await stat(resolvedPath)).isFile()) {
      const file = await readFile(resolvedPath);
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(resolvedPath)] || 'application/octet-stream' });
      response.end(file);
      return;
    }
  } catch {
    // SPA routes fall through to index.html.
  }

  try {
    const indexHtml = await readFile(resolve(distDirectory, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(indexHtml);
  } catch {
    sendJson(response, 404, { error: 'Frontend build not found. Run npm run build first.' });
  }
};

const server = createServer(async (request, response) => {
  applySecurityHeaders(response);
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;

  try {
    if (pathname.startsWith('/api/')) {
      const origin = request.headers.origin;
      const fetchSite = request.headers['sec-fetch-site'];
      const isCrossSite = fetchSite === 'cross-site';
      const hasDisallowedOrigin = Boolean(origin && !allowedBrowserOrigins.has(origin));

      if (isCrossSite || hasDisallowedOrigin) {
        sendJson(response, 403, { error: 'Cross-origin API requests are not allowed.' });
        return;
      }
    }

    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        providers: {
          openai: {
            configured: isOpenAIConfigured(),
            model: getOpenAIModel(),
            lightModel: getOpenAILightModel()
          },
          seedream: {
            configured: isSeedreamConfigured(),
            model: getSeedreamModel(),
            maxConcurrency: getSeedreamMaxConcurrency()
          }
        }
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/brain/generate') {
      sendJson(response, 200, await generateBrainResponse(await readJsonBody<BrainRequest>(request)));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/brain/chat') {
      const body = await readJsonBody<BrainRequest>(request);
      sendJson(response, 200, await generateBrainResponse({ ...body, system: body.system || 'You are an expert Etsy mentor for digital sticker sellers.' }));
      return;
    }

    if (request.method === 'POST' && pathname === '/api/images/generate') {
      sendJson(response, 200, await generateSeedreamImage(await readJsonBody<ImageRequest>(request)));
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API route not found.' });
      return;
    }

    await serveFrontend(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    console.error(`[${request.method}] ${pathname}: ${message}`);
    if (!response.headersSent && !response.writableEnded) {
      sendJson(response, 500, { error: message });
    } else if (!response.writableEnded) {
      response.end();
    }
  }
});

server.listen(port, loopbackHost, () => {
  console.log(`StickerOS API listening on http://localhost:${port}`);
  console.log(`OpenAI key loaded from ${openAIKeyLocation || 'no environment file'} as ${getOpenAIKeySource() || 'no environment variable'} (${getOpenAIKeyHint() || 'not configured'}).`);
  console.log(`OpenAI routing: standard=${getOpenAIModel()} • light=${getOpenAILightModel()}.`);
  console.log(`Seedream key loaded from ${getSeedreamKeySource() || 'no environment variable'} (${getSeedreamKeyHint() || 'not configured'}).`);
});
