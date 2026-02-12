'use client';

/**
 * BambuSend – Odoslanie STL na Bambu Lab tlačiareň
 *
 * Funkcie:
 *   1. Stiahnuť .3MF (otvorí sa v Bambu Studio)
 *   2. Priamo odoslať na tlačiareň cez LAN (FTP + MQTT)
 *   3. Monitorovať stav tlačiarne
 */

import { useState, useCallback, useEffect } from 'react';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface BambuPrinterConfig {
  name: string;
  ip: string;
  serial: string;
  accessCode: string;
  model: string;
}

interface PrinterStatus {
  success: boolean;
  state?: string;
  progress?: number;
  remaining_minutes?: number;
  current_layer?: number;
  total_layers?: number;
  nozzle_temp?: number;
  bed_temp?: number;
  chamber_temp?: number;
  subtask_name?: string;
  error?: string;
}

interface BambuSendProps {
  jobId: string | null;
  material?: string;
}

// ─────────────────────────────────────────
// Konštanty
// ─────────────────────────────────────────

const PRINTER_MODELS = [
  { value: 'x1c', label: 'X1 Carbon', icon: '🖨️' },
  { value: 'p1s', label: 'P1S', icon: '🖨️' },
  { value: 'p1p', label: 'P1P', icon: '🖨️' },
  { value: 'a1', label: 'A1', icon: '🖨️' },
  { value: 'a1_mini', label: 'A1 Mini', icon: '🖨️' },
];

const PRINT_MATERIALS = [
  { value: 'ASA', label: 'ASA', desc: 'UV odolný, exteriér', color: '#FFB74D' },
  { value: 'ABS', label: 'ABS', desc: 'Odolný, interiér', color: '#E0E0E0' },
  { value: 'PETG', label: 'PETG', desc: 'Priehľadný, čelo', color: '#81D4FA' },
  { value: 'PLA', label: 'PLA', desc: 'Prototypy', color: '#A5D6A7' },
];

const STATE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  idle: { label: 'Pripravená', color: 'text-green-400', icon: '✅' },
  preparing: { label: 'Príprava', color: 'text-yellow-400', icon: '⏳' },
  printing: { label: 'Tlačí', color: 'text-blue-400', icon: '🖨️' },
  paused: { label: 'Pozastavená', color: 'text-amber-400', icon: '⏸️' },
  finished: { label: 'Dokončená', color: 'text-green-400', icon: '✅' },
  failed: { label: 'Chyba', color: 'text-red-400', icon: '❌' },
};

const STORAGE_KEY = 'bambu_printer_config';

// ─────────────────────────────────────────
// Komponent
// ─────────────────────────────────────────

export default function BambuSend({ jobId, material = 'ASA' }: BambuSendProps) {
  // Stav
  const [mode, setMode] = useState<'download' | 'lan' | 'settings'>('download');
  const [printer, setPrinter] = useState<BambuPrinterConfig>({
    name: 'Moja Bambu Lab',
    ip: '',
    serial: '',
    accessCode: '',
    model: 'x1c',
  });
  const [selectedMaterial, setSelectedMaterial] = useState(material);
  const [isConverting, setIsConverting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus | null>(null);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);

  // Načítať uloženú konfiguráciu tlačiarne
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPrinter(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  // Uložiť konfiguráciu
  const savePrinterConfig = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(printer));
    } catch {
      // ignore
    }
  }, [printer]);

  // ─── Stiahnuť .3MF ───
  const handleDownload3MF = useCallback(async () => {
    if (!jobId) return;

    setIsConverting(true);
    setError(null);

    try {
      const res = await fetch('/api/bambu/convert-3mf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          material: selectedMaterial,
          printerModel: printer.model,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Konverzia zlyhala');
        return;
      }

      // Stiahnuť .3mf
      window.open(data.downloadUrl, '_blank');
    } catch (err) {
      setError('Chyba pripojenia k STL generátoru');
      console.error(err);
    } finally {
      setIsConverting(false);
    }
  }, [jobId, selectedMaterial, printer.model]);

  // ─── Odoslať na tlačiareň ───
  const handleSendToPrinter = useCallback(async () => {
    if (!jobId) return;
    if (!printer.ip || !printer.accessCode) {
      setError('Vyplňte IP adresu a access code tlačiarne');
      return;
    }

    setIsSending(true);
    setError(null);
    setSendResult(null);

    try {
      const res = await fetch('/api/bambu/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          printer: {
            name: printer.name,
            ip: printer.ip,
            serial: printer.serial,
            access_code: printer.accessCode,
            model: printer.model,
          },
          autoStart,
          printSettings: {
            material: selectedMaterial,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        savePrinterConfig();
        setSendResult({
          success: true,
          message: autoStart
            ? `Odoslané na ${printer.name} – tlač spustená!`
            : `Odoslané na ${printer.name} – otvorte v Bambu Studio.`,
        });
      } else {
        setSendResult({
          success: false,
          message: data.error || data.message || 'Odoslanie zlyhalo',
        });
      }
    } catch (err) {
      setError('Chyba pripojenia');
      console.error(err);
    } finally {
      setIsSending(false);
    }
  }, [jobId, printer, autoStart, selectedMaterial, savePrinterConfig]);

  // ─── Stav tlačiarne ───
  const checkPrinterStatus = useCallback(async () => {
    if (!printer.ip || !printer.accessCode) {
      setError('Vyplňte IP a access code');
      return;
    }

    setIsCheckingStatus(true);
    setError(null);

    try {
      const res = await fetch('/api/bambu/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: printer.ip,
          access_code: printer.accessCode,
          serial: printer.serial,
          model: printer.model,
        }),
      });

      const data = await res.json();
      setPrinterStatus(data);
    } catch (err) {
      setPrinterStatus({ success: false, error: 'Nedostupná' });
      console.error(err);
    } finally {
      setIsCheckingStatus(false);
    }
  }, [printer]);

  // ─── Render ───
  if (!jobId) {
    return (
      <div className="glass rounded-xl p-5 space-y-3 opacity-50">
        <h3 className="text-sm font-medium text-slate-300">
          🖨️ Bambu Lab Studio
        </h3>
        <p className="text-xs text-slate-500">
          Najprv vygenerujte STL súbory
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">
          🖨️ Bambu Lab Studio
        </h3>
        <button
          onClick={() => setMode(mode === 'settings' ? 'download' : 'settings')}
          className="text-xs text-slate-500 hover:text-white transition-colors"
          title="Nastavenia tlačiarne"
        >
          ⚙️
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1">
        <button
          onClick={() => setMode('download')}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
            mode === 'download'
              ? 'bg-[#2a2a2a] text-white'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          📥 Stiahnuť .3MF
        </button>
        <button
          onClick={() => setMode('lan')}
          className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
            mode === 'lan'
              ? 'bg-[#2a2a2a] text-white'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          📡 Priama tlač
        </button>
      </div>

      {/* ───── Settings panel ───── */}
      {mode === 'settings' && (
        <div className="space-y-3 animate-in fade-in">
          <p className="text-xs text-slate-400 font-medium">Nastavenia tlačiarne</p>

          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                Názov
              </label>
              <input
                type="text"
                value={printer.name}
                onChange={(e) =>
                  setPrinter({ ...printer, name: e.target.value })
                }
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white"
                placeholder="Moja Bambu Lab"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                IP adresa (v lokálnej sieti)
              </label>
              <input
                type="text"
                value={printer.ip}
                onChange={(e) =>
                  setPrinter({ ...printer, ip: e.target.value })
                }
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                placeholder="192.168.1.100"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                Access Code (z displeja tlačiarne)
              </label>
              <input
                type="password"
                value={printer.accessCode}
                onChange={(e) =>
                  setPrinter({ ...printer, accessCode: e.target.value })
                }
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                placeholder="12345678"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                Sériové číslo (voliteľné)
              </label>
              <input
                type="text"
                value={printer.serial}
                onChange={(e) =>
                  setPrinter({ ...printer, serial: e.target.value })
                }
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white font-mono"
                placeholder="01P09C..."
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                Model
              </label>
              <div className="grid grid-cols-3 gap-1">
                {PRINTER_MODELS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() =>
                      setPrinter({ ...printer, model: m.value })
                    }
                    className={`py-1.5 px-2 rounded text-[10px] font-medium transition-colors ${
                      printer.model === m.value
                        ? 'bg-[#f59e0b] text-[#0a0a0a]'
                        : 'bg-[#1a1a1a] text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                savePrinterConfig();
                setMode('download');
              }}
              className="flex-1 py-2 rounded-lg bg-[#f59e0b] text-[#0a0a0a] text-xs font-semibold hover:bg-[#d97706] transition-colors"
            >
              💾 Uložiť
            </button>
            <button
              onClick={checkPrinterStatus}
              disabled={isCheckingStatus || !printer.ip}
              className="py-2 px-3 rounded-lg bg-[#1a1a1a] text-slate-300 text-xs hover:bg-[#2a2a2a] transition-colors disabled:opacity-50"
            >
              {isCheckingStatus ? '⏳' : '🔍'} Test
            </button>
          </div>

          {/* Status po teste */}
          {printerStatus && (
            <div
              className={`rounded-lg p-2 text-xs ${
                printerStatus.success
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}
            >
              {printerStatus.success ? (
                <div className="space-y-1">
                  <p className="font-medium">
                    {STATE_LABELS[printerStatus.state || '']?.icon || '🖨️'}{' '}
                    {STATE_LABELS[printerStatus.state || '']?.label || printerStatus.state}
                  </p>
                  {printerStatus.state === 'printing' && (
                    <div>
                      <div className="flex justify-between text-[10px]">
                        <span>Progres</span>
                        <span>{printerStatus.progress}%</span>
                      </div>
                      <div className="w-full bg-[#1a1a1a] rounded-full h-1.5 mt-1">
                        <div
                          className="bg-blue-500 rounded-full h-1.5 transition-all"
                          style={{ width: `${printerStatus.progress || 0}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Vrstva {printerStatus.current_layer}/{printerStatus.total_layers} ·{' '}
                        Zostáva ~{printerStatus.remaining_minutes} min
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">
                    🌡️ Nozzle: {printerStatus.nozzle_temp}°C · Bed: {printerStatus.bed_temp}°C
                  </p>
                </div>
              ) : (
                <p>❌ {printerStatus.error || 'Tlačiareň nedostupná'}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ───── Download .3MF ───── */}
      {mode === 'download' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            Stiahne .3MF súbor s prednastavenými parametrami.
            Otvorte v <strong className="text-slate-300">Bambu Studio</strong> →
            skontrolujte rozloženie → tlačte.
          </p>

          {/* Materiál */}
          <div>
            <label className="text-[10px] text-slate-500 block mb-1.5">
              Materiál pre Bambu Studio
            </label>
            <div className="grid grid-cols-4 gap-1">
              {PRINT_MATERIALS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedMaterial(m.value)}
                  className={`py-1.5 px-1 rounded text-center transition-colors ${
                    selectedMaterial === m.value
                      ? 'ring-1 ring-[#f59e0b] bg-[#1a1a1a]'
                      : 'bg-[#1a1a1a] hover:bg-[#2a2a2a]'
                  }`}
                >
                  <div
                    className="w-4 h-4 rounded-full mx-auto mb-0.5"
                    style={{ backgroundColor: m.color }}
                  />
                  <div className="text-[10px] font-medium text-white">
                    {m.label}
                  </div>
                  <div className="text-[8px] text-slate-500">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Model tlačiarne */}
          <div>
            <label className="text-[10px] text-slate-500 block mb-1.5">
              Model tlačiarne
            </label>
            <select
              value={printer.model}
              onChange={(e) => setPrinter({ ...printer, model: e.target.value })}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-xs text-white"
            >
              {PRINTER_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  Bambu Lab {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload3MF}
            disabled={isConverting}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              isConverting
                ? 'bg-slate-800 text-slate-500 cursor-wait'
                : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-500/20'
            }`}
          >
            {isConverting ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Konvertujem na .3MF...
              </>
            ) : (
              <>📥 Stiahnuť .3MF pre Bambu Studio</>
            )}
          </button>

          <p className="text-[10px] text-slate-600 text-center">
            Kompatibilné s Bambu Studio, OrcaSlicer, PrusaSlicer
          </p>
        </div>
      )}

      {/* ───── LAN Send ───── */}
      {mode === 'lan' && (
        <div className="space-y-3">
          {!printer.ip ? (
            <div className="text-center py-4 space-y-2">
              <p className="text-2xl">📡</p>
              <p className="text-xs text-slate-400">
                Najprv nastavte tlačiareň
              </p>
              <button
                onClick={() => setMode('settings')}
                className="text-xs text-[#f59e0b] hover:underline"
              >
                ⚙️ Otvoriť nastavenia
              </button>
            </div>
          ) : (
            <>
              {/* Printer info */}
              <div className="bg-[#1a1a1a] rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">
                    {printer.name}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {printer.ip} · {PRINTER_MODELS.find((m) => m.value === printer.model)?.label || printer.model}
                  </p>
                </div>
                <button
                  onClick={checkPrinterStatus}
                  disabled={isCheckingStatus}
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  {isCheckingStatus ? '⏳' : '🔄'}
                </button>
              </div>

              {/* Status indicator */}
              {printerStatus?.success && (
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      printerStatus.state === 'idle'
                        ? 'bg-green-400'
                        : printerStatus.state === 'printing'
                          ? 'bg-blue-400 animate-pulse'
                          : 'bg-amber-400'
                    }`}
                  />
                  <span className={STATE_LABELS[printerStatus.state || '']?.color || 'text-slate-400'}>
                    {STATE_LABELS[printerStatus.state || '']?.label || printerStatus.state}
                  </span>
                  {printerStatus.state === 'printing' && (
                    <span className="text-slate-500">
                      {printerStatus.progress}% · ~{printerStatus.remaining_minutes}min
                    </span>
                  )}
                </div>
              )}

              {/* Auto-start toggle */}
              <div className="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-slate-300">Auto-start tlače</p>
                  <p className="text-[10px] text-slate-500">
                    Automaticky spustí tlač po uploade
                  </p>
                </div>
                <button
                  onClick={() => setAutoStart(!autoStart)}
                  className={`w-10 h-5 rounded-full transition-colors ${
                    autoStart ? 'bg-[#f59e0b]' : 'bg-[#2a2a2a]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      autoStart ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Send button */}
              <button
                onClick={handleSendToPrinter}
                disabled={isSending}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                  isSending
                    ? 'bg-slate-800 text-slate-500 cursor-wait'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20'
                }`}
              >
                {isSending ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Odosielam na tlačiareň...
                  </>
                ) : (
                  <>📡 Odoslať na {printer.name}</>
                )}
              </button>

              {/* Result */}
              {sendResult && (
                <div
                  className={`rounded-lg p-3 text-xs ${
                    sendResult.success
                      ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                      : 'bg-red-500/10 border border-red-500/20 text-red-400'
                  }`}
                >
                  <p>{sendResult.success ? '✅' : '❌'} {sendResult.message}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
