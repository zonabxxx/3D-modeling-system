/**
 * POST /api/bambu/send
 *
 * Odošle vygenerované STL priamo na Bambu Lab tlačiareň.
 * 
 * Body: {
 *   jobId: string,
 *   printer: { name, ip, serial, access_code, model },
 *   autoStart?: boolean,
 *   printSettings?: { ... }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

const STL_SERVICE_URL = process.env.STL_SERVICE_URL || 'http://localhost:8000';

interface SendRequest {
  jobId: string;
  printer: {
    name?: string;
    ip: string;
    serial?: string;
    access_code: string;
    model?: string;
  };
  autoStart?: boolean;
  printSettings?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body: SendRequest = await req.json();

    if (!body.jobId) {
      return NextResponse.json({ error: 'jobId je povinný' }, { status: 400 });
    }

    if (!body.printer?.ip || !body.printer?.access_code) {
      return NextResponse.json(
        { error: 'IP adresa a access code sú povinné' },
        { status: 400 },
      );
    }

    const res = await fetch(`${STL_SERVICE_URL}/send-to-bambu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: body.jobId,
        printer: {
          name: body.printer.name || 'Bambu Lab Printer',
          ip: body.printer.ip,
          serial: body.printer.serial || '',
          access_code: body.printer.access_code,
          model: body.printer.model || 'x1c',
        },
        auto_start: body.autoStart || false,
        print_settings: body.printSettings || {},
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
      return NextResponse.json(
        {
          error: 'bambu_send_failed',
          message: err.detail || 'Odoslanie zlyhalo',
        },
        { status: res.status },
      );
    }

    const data = await res.json();

    return NextResponse.json({
      success: data.success,
      uploaded: data.uploaded,
      filename: data.filename,
      printer: data.printer,
      printerIp: data.printer_ip,
      printStarted: data.print_started,
      printError: data.print_error,
      error: data.error,
    });
  } catch (err) {
    console.error('bambu send proxy error:', err);

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
