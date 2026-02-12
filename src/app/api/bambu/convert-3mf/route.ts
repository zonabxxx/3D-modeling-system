/**
 * POST /api/bambu/convert-3mf
 *
 * Konvertuje vygenerované STL na .3MF formát pre Bambu Studio.
 * Body: { jobId, projectName?, material?, printerModel?, printSettings? }
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

interface ConvertRequest {
  jobId: string;
  projectName?: string;
  material?: string;
  printerModel?: string;
  printSettings?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body: ConvertRequest = await req.json();

    if (!body.jobId) {
      return NextResponse.json(
        { error: 'jobId je povinný' },
        { status: 400 },
      );
    }

    const res = await fetch(`${STL_SERVICE_URL}/convert-to-3mf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: body.jobId,
        project_name: body.projectName || 'ADSUN Sign',
        material: body.material || 'ASA',
        printer_model: body.printerModel || 'x1c',
        print_settings: body.printSettings || {},
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      return NextResponse.json(
        { error: err.detail || 'Konverzia zlyhala' },
        { status: res.status },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      success: true,
      downloadUrl: `/api/bambu/download-3mf?jobId=${body.jobId}`,
      directUrl: `${STL_SERVICE_URL}${data.download_url}`,
      filename: data.filename,
      printerModel: data.printer_model,
      material: data.material,
    });
  } catch (err) {
    console.error('convert-3mf proxy error:', err);

    const isConnErr =
      err instanceof Error &&
      (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed'));

    if (isConnErr) {
      return NextResponse.json(
        { error: 'STL generátor nie je spustený' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  }
}
