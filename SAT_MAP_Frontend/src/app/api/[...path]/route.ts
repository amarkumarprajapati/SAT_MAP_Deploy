import { NextRequest, NextResponse } from 'next/server';

/**
 * Keep browser API calls same-origin. The FastAPI service is only reachable
 * from the Next server in Docker, and direct browser calls trigger CORS and
 * Private Network Access checks in modern browsers.
 */
const backendBaseUrl = () =>
  (process.env.FASTAPI_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://127.0.0.1:8569')
    .replace(/\/+$/, '');

export async function proxyApiRequest(request: NextRequest, path: string[]) {
  const target = new URL(`${backendBaseUrl()}/api/${path.map(encodeURIComponent).join('/')}`);
  target.search = request.nextUrl.search;
  // Keep tile request templates intact while still proxying their requests to FastAPI.
  if (path[0] === 'map' && path[1] === 'imagery') {
    target.pathname = `${backendBaseUrl().replace(/\/+$/, '')}/api/map/imagery/${path.slice(2).join('/')}`;
  }
  if (path[0] === 'map' && path[1] === 'terrain') {
    target.pathname = `${backendBaseUrl().replace(/\/+$/, '')}/api/map/terrain/${path.slice(2).join('/')}`;
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('origin');

  const isMapAsset = path[0] === 'map';
  const isEventStream = headers.get('accept')?.includes('text/event-stream') ?? false;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: isMapAsset ? 'force-cache' : 'no-store',
      signal: isEventStream ? request.signal : AbortSignal.timeout(30_000),
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('content-encoding');

    if (isMapAsset) {
      responseHeaders.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    } else if (['GET', 'HEAD'].includes(request.method)) {
      if (!responseHeaders.has('Cache-Control') || responseHeaders.get('Cache-Control')?.includes('no-store')) {
        responseHeaders.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
      }
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Backend request failed';
    console.error(`[API proxy] ${request.method} ${target.pathname} failed: ${detail}`);
    return NextResponse.json(
      { error: 'Backend unavailable', detail, backend: backendBaseUrl() },
      { status: 502 },
    );
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyApiRequest(request, path);
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
