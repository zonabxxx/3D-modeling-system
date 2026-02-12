/**
 * POST /api/bambu/status
 *
 * Získa aktuálny stav Bambu Lab tlačiarne.
 * Body: { ip, serial?, access_code, model? }
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

interface StatusRequest {
  ip: string;
  serial?: string;
  access_code: string;
  model?: string;
  name?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: StatusRequest = await req.json();

    if (!body.ip || !body.access_code) {
      return NextResponse.json(
        { error: 'IP adresa a access code sú povinné' },
        { status: 400 },
      );
    }

    const res = await fetch(`${STL_SERVICE_URL}/bambu/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name || 'Bambu Lab Printer',
        ip: body.ip,
        serial: body.serial || '',
        access_code: body.access_code,
        model: body.model || 'x1c',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      return NextResponse.json(
        { error: err.detail || 'Stav nedostupný' },
        { status: res.status },
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error('bambu status proxy error:', err);
    return NextResponse.json(
      { error: 'Služba nedostupná' },
      { status: 503 },
    );
  }
}
