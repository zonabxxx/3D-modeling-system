/**
 * GET /api/bambu/download-3mf?jobId=xxx
 *
 * Stiahne .3MF súbor pre Bambu Studio.
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');

  if (!jobId || !/^[a-f0-9-]+$/i.test(jobId)) {
    return NextResponse.json({ error: 'Neplatné jobId' }, { status: 400 });
  }

  try {
    const res = await fetch(`${STL_SERVICE_URL}/download-3mf/${jobId}`);

    if (!res.ok) {
      return NextResponse.json(
        { error: '.3MF súbor nenájdený. Najprv konvertujte.' },
        { status: 404 },
      );
    }

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        'Content-Disposition': `attachment; filename="adsun_sign_${jobId}.3mf"`,
      },
    });
  } catch (err) {
    console.error('3MF download proxy error:', err);
    return NextResponse.json(
      { error: 'STL generátor nie je dostupný' },
      { status: 503 },
    );
  }
}
