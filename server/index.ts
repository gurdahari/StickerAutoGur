import dotenv from 'dotenv';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { BrainRequest, ImageRequest } from './contracts.js';
import { generateBrainResponse, getOpenAIModel, isOpenAIConfigured } from './providers/openaiBrain.js';
import {
  generateSeedreamImage,
  getSeedreamKeyHint,
  getSeedreamKeySource,
  getSeedreamLastSuccessfulRequestAt,
  getSeedreamModel,
  isSeedreamConfigured
} from './providers/seedream.js';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const port = Number(process.env.PORT || 8787);
const bodyLimitBytes = 50 * 1024 * 1024;
const distDirectory = resolve(process.cwd(), 'dist');

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
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(payload);
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
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;

  try {
    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        providers: {
          openai: { configured: isOpenAIConfigured(), model: getOpenAIModel() },
          seedream: {
            configured: isSeedreamConfigured(),
            model: getSeedreamModel(),
            keyHint: getSeedreamKeyHint(),
            keySource: getSeedreamKeySource(),
            lastSuccessfulRequestAt: getSeedreamLastSuccessfulRequestAt()
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

server.listen(port, '0.0.0.0', () => {
  console.log(`StickerOS API listening on http://localhost:${port}`);
  console.log(`Seedream key loaded from ${getSeedreamKeySource() || 'no environment variable'} (${getSeedreamKeyHint() || 'not configured'}).`);
});
