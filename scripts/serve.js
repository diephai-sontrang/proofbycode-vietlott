import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDirectory = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function resolveRequestPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(rootDirectory, relativePath);
  if (resolvedPath !== rootDirectory && !resolvedPath.startsWith(`${rootDirectory}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

const server = createServer(async (request, response) => {
  try {
    const filePath = resolveRequestPath(request.url ?? '/');
    if (filePath === null) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Local preview: http://localhost:${port}/`);
});
