import { NextResponse } from 'next/server';
import { envStatus } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    env: envStatus(),
  });
}
