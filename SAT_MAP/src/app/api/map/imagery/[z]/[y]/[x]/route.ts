import { NextRequest } from 'next/server';
import { proxyApiRequest } from '@/app/api/[...path]/route';

type RouteContext = {
  params: Promise<{ z: string; y: string; x: string }>;
};

async function proxyImageryTile(request: NextRequest, context: RouteContext) {
  const { z, y, x } = await context.params;
  return proxyApiRequest(request, ['map', 'imagery', z, y, x]);
}

export const GET = proxyImageryTile;
export const HEAD = proxyImageryTile;
