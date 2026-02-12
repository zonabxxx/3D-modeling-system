/**
 * GET /api/generate-stl/download?jobId=xxx
 *
 * Proxy pre stiahnutie ZIP so STL súbormi z CadQuery microservice.
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');

  if (!jobId || !/^[a-f0-9-]+$/i.test(jobId)) {
    return NextResponse.json(
      { error: 'Neplatné jobId' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${STL_SERVICE_URL}/download/${jobId}`);

    if (!res.ok) {
      return NextResponse.json(
        { error: 'ZIP súbor nenájdený' },
        { status: 404 },
      );
    }

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="adsun_sign_${jobId}.zip"`,
      },
    });
  } catch (err) {
    console.error('STL download proxy error:', err);
    return NextResponse.json(
      { error: 'STL generátor nie je dostupný' },
      { status: 503 },
    );
  }
}
