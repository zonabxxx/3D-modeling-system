/**
 * GET /api/stl-preview/[jobId]/[filename]
 *
 * Proxy na CadQuery microservice pre servírovanie jednotlivých STL súborov.
 * Používa sa pre 3D náhľad vygenerovaných dielov v prehliadači.
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> },
) {
  const { jobId, filename } = await params;

  try {
    const res = await fetch(
      `${STL_SERVICE_URL}/stl-file/${jobId}/${filename}`,
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: 'STL súbor nenájdený' },
        { status: res.status },
      );
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/sla',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'STL generátor nie je dostupný' },
      { status: 503 },
    );
  }
}
