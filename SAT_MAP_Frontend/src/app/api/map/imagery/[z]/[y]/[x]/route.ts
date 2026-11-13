import { NextRequest } from 'next/server';
import { proxyApiRequest } from '@/app/api/[...path]/route';

type RouteContext = {
  params: Promise<{ z: string; y: string; x: string }>;
};

async function proxyImageryTile(request: NextRequest, context: RouteContext) {
  const { z, y, x } = await context.params;
  const response = await proxyApiRequest(request, ['map', 'imagery', z, y, x]);
  // Imagery tiles are immutable for this URL; let browser/CDN caches absorb
  // repeated globe rotations instead of re-fetching every tile from origin.
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const GET = proxyImageryTile;
export const HEAD = proxyImageryTile;
