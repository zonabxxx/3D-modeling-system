'use client';

/**
 * STLDownload – Generovanie a stiahnutie výrobných STL súborov
 *
 * Zobrazuje:
 *  - Tlačidlo "Generovať STL" s loading stavom
 *  - Po generovaní: prehľad dielov, hmotnosť, LED count
 *  - Tlačidlo na stiahnutie ZIP
 *  - Zoznam vygenerovaných dielov per písmeno
 */

import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { textToSVG } from '@/lib/text-to-svg';
import { cleanSVG } from '@/lib/svg-utils';

const BambuSend = lazy(() => import('./BambuSend'));
const STLViewer = lazy(() => import('./STLViewer'));

interface PartInfo {
  name: string;
  filename: string;
  part_type: string;
  description: string;
}

interface LetterInfo {
  char: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  parts_count: number;
  is_segmented: boolean;
  segment_count: number;
  led_count: number;
  weight_g: number;
  parts: PartInfo[];
}

interface STLResult {
  jobId: string;
  downloadUrl: string;
  directUrl: string;
  totalParts: number;
  totalWeightG: number;
  totalLedCount: number;
  lightingType: string;
  material: string;
  letters: LetterInfo[];
}

const LIGHTING_LABELS: Record<string, string> = {
  channel: 'Kanálové písmeno',
  channel_front: 'Kanálové s LED',
  none: 'Bez podsvitu',
  front: 'Front-lit',
  halo: 'Halo',
  front_halo: 'Front + Halo',
};

const PART_ICONS: Record<string, string> = {
  shell: '🧊',
  face: '🔲',
  back: '🔳',
  mounting: '🔩',
  rib: '📏',
  solid: '⬛',
};

interface PresetOption {
  id: string;
  name: string;
  lightingType: string;
  wallThickness: number;
  externalWallRecess: number | null;
}

export default function STLDownload({ fullView = false }: { fullView?: boolean }) {
  const text = useConfiguratorStore((s) => s.text);
  const fontUrl = useConfiguratorStore((s) => s.fontUrl);
  const depthMm = useConfiguratorStore((s) => s.depthMm);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const profileType = useConfiguratorStore((s) => s.profileType);
  const computed = useConfiguratorStore((s) => s.computed);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const setLogoSVG = useConfiguratorStore((s) => s.setLogoSVG);
  const setContentType = useConfiguratorStore((s) => s.setContentType);

  // Track previous contentType so we can restore it on SVG clear
  const prevContentTypeRef = useRef(contentType);

  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<STLResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedLetter, setExpandedLetter] = useState<string | null>(null);

  // SVG upload state
  const [uploadedSvg, setUploadedSvg] = useState<{
    content: string;
    fileName: string;
    previewUrl: string;
  } | null>(null);
  const [svgSource, setSvgSource] = useState<'text' | 'upload'>('text');

  // Preset selector
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then((data) => {
        if (data.presets && data.presets.length > 0) {
          setPresets(
            data.presets.map((p: Record<string, unknown>) => ({
              id: p.id as string,
              name: p.name as string,
              lightingType: p.lightingType as string,
              wallThickness: p.wallThickness as number,
              externalWallRecess: p.externalWallRecess as number | null,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  // SVG upload handler
  const handleSvgUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.svg') && file.type !== 'image/svg+xml') {
      setError('Nahrajte súbor vo formáte SVG (.svg)');
      return;
    }

    const content = await file.text();
    if (!content) return;

    // Validácia: musí obsahovať vektorové tvary
    const hasGeometry =
      content.includes('<path') ||
      content.includes('<polygon') ||
      content.includes('<rect') ||
      content.includes('<circle') ||
      content.includes('<ellipse');

    if (!hasGeometry) {
      setError('SVG súbor neobsahuje žiadne vektorové tvary (path, polygon, rect, ...).');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    // Vyčisti SVG — odstráň pozadie, nájdi rozmery
    const result = await cleanSVG(content);

    setUploadedSvg({ content: result.svg, fileName: file.name, previewUrl });
    setSvgSource('upload');
    setError(null);
    setResult(null);

    // Synchronizácia so store
    prevContentTypeRef.current = useConfiguratorStore.getState().contentType;
    setLogoSVG(previewUrl, result.svg, result.width, result.height);
    setContentType('logo_only');
  }, [setLogoSVG, setContentType]);

  const handleClearSvg = useCallback(() => {
    if (uploadedSvg?.previewUrl) {
      URL.revokeObjectURL(uploadedSvg.previewUrl);
    }
    setUploadedSvg(null);
    setSvgSource('text');
    setResult(null);

    // Obnoviť predchádzajúci content type v store
    setContentType(prevContentTypeRef.current || 'text_only');
  }, [uploadedSvg, setContentType]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const letterHeightMm = computed.letterHeightMm || 200;

      // ── SVG-based flow (ako LetraMaker PRO) ──
      let svgContent: string | null = null;
      let labelText = text || 'ADSUN';

      if (svgSource === 'upload' && uploadedSvg) {
        // ── Uploadnuté SVG – priamo použiť ──
        svgContent = uploadedSvg.content;
        labelText = uploadedSvg.fileName.replace(/\.svg$/i, '');
      } else if (contentType !== 'text_only' && logo.sourceType === 'svg' && logo.svgContent) {
        // Logo – priamo použiť SVG obsah
        svgContent = logo.svgContent;
      } else {
        // Text → SVG konverzia na frontende
        const inputText = text || 'ADSUN';
        try {
          const svgResult = await textToSVG(inputText, fontUrl, letterHeightMm, 10);
          svgContent = svgResult.svgContent;

          if (!svgResult.letters.length) {
            setError(
              'Zvolený font nepodporuje zadané znaky.\n' +
              'Skúste iný font alebo zmeňte text.',
            );
            return;
          }
        } catch (svgErr) {
          console.error('Text → SVG conversion failed:', svgErr);
          setError('Chyba konverzie textu na SVG krivky. Skúste iný font.');
          return;
        }
      }

      const body: Record<string, unknown> = {
        svgContent,
        text: labelText,
        letterHeightMm,
        depthMm,
        lightingType,
        material: 'asa',
        profileType,
      };

      // Ak je vybraný preset, pridať ho
      if (selectedPresetId) {
        body.presetId = selectedPresetId;
      }

      const res = await fetch('/api/generate-stl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'service_unavailable') {
          setError(
            'STL generátor nie je spustený. Spustite:\n' +
              'cd stl-generator && docker compose up',
          );
        } else {
          setError(data.message || 'Generovanie zlyhalo');
        }
        return;
      }

      // Kontrola: ak sa nevygenerovali žiadne diely
      if (data.totalParts === 0 || !data.letters || data.letters.length === 0) {
        setError(
          'Neboli vygenerované žiadne diely.\n' +
            'Skontrolujte SVG krivky alebo skúste iný text/font.',
        );
        return;
      }

      setResult(data);
    } catch (err) {
      console.error('STL generation error:', err);
      setError('Chyba pripojenia k STL generátoru');
    } finally {
      setIsGenerating(false);
    }
  }, [text, fontUrl, depthMm, lightingType, profileType, computed, contentType, logo, selectedPresetId, svgSource, uploadedSvg]);

  const handleDownload = useCallback(() => {
    if (!result?.downloadUrl) return;
    window.open(result.downloadUrl, '_blank');
  }, [result]);

  return (
    <div className="glass rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">
          🏭 Výrobné STL súbory
        </h3>
        {result && (
          <span className="text-xs text-green-400">
            ✓ Vygenerované
          </span>
        )}
      </div>

      {/* Info */}
      <p className="text-xs text-slate-500 leading-relaxed">
        Vygeneruje kompletné výrobné STL pre 3D tlač: korpus, čelo,
        zadný panel, montážne dištance – všetko podľa zvoleného
        podsvietenia ({LIGHTING_LABELS[lightingType] || lightingType}).
      </p>

      {/* SVG Source Selector */}
      {!result && (
        <div className="space-y-3">
          {/* Toggle: Text vs SVG Upload */}
          <div className="flex gap-2">
            <button
              onClick={() => { setSvgSource('text'); setError(null); }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                svgSource === 'text'
                  ? 'bg-[#f59e0b]/15 border border-[#f59e0b] text-[#f59e0b]'
                  : 'bg-[#1a1a1a] border border-[#2a2a2a] text-slate-400 hover:border-slate-500'
              }`}
            >
              🔤 Z textu
            </button>
            <button
              onClick={() => { setSvgSource('upload'); setError(null); }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                svgSource === 'upload'
                  ? 'bg-[#f59e0b]/15 border border-[#f59e0b] text-[#f59e0b]'
                  : 'bg-[#1a1a1a] border border-[#2a2a2a] text-slate-400 hover:border-slate-500'
              }`}
            >
              📄 Upload SVG
            </button>
          </div>

          {/* SVG Upload Area */}
          {svgSource === 'upload' && (
            <div className="space-y-2">
              {!uploadedSvg ? (
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-[#333] rounded-xl cursor-pointer hover:border-[#f59e0b]/50 hover:bg-[#f59e0b]/5 transition-all">
                  <div className="text-2xl mb-1">📄</div>
                  <span className="text-xs text-slate-400">
                    Kliknite alebo presuňte SVG súbor
                  </span>
                  <span className="text-[10px] text-slate-600 mt-0.5">
                    Podporované: .svg (vektorové krivky)
                  </span>
                  <input
                    type="file"
                    accept=".svg,image/svg+xml"
                    onChange={handleSvgUpload}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] p-3 space-y-2">
                  {/* SVG Preview */}
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 bg-white rounded-lg flex-shrink-0 p-1 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={uploadedSvg.previewUrl}
                        alt="SVG preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {uploadedSvg.fileName}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        SVG súbor pripravený na 3D extrúziu
                      </p>
                      <p className="text-[10px] text-emerald-400 mt-0.5">
                        ✓ Vektorové krivky načítané
                      </p>
                    </div>
                    <button
                      onClick={handleClearSvg}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1"
                      title="Odstrániť SVG"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {svgSource === 'upload' && !uploadedSvg && (
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  💡 Tip: Nahrajte SVG logo, ikonu alebo ľubovoľný vektorový tvar.
                  Backend ho extruduje do 3D podľa zvoleného presetu a nastavení.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Preset selector */}
      {presets.length > 0 && !result && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            Výrobný preset (voliteľný)
          </label>
          <select
            value={selectedPresetId}
            onChange={(e) => setSelectedPresetId(e.target.value)}
            className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-sm text-white focus:border-[#f59e0b] focus:outline-none transition-colors cursor-pointer"
          >
            <option value="">— Predvolené pravidlá —</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({LIGHTING_LABELS[p.lightingType] || p.lightingType}, stena {p.wallThickness}mm
                {(p.externalWallRecess ?? 0) > 0 ? `, drážka ${p.externalWallRecess}mm` : ''})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Generate button */}
      {!result && (
        <button
          onClick={handleGenerate}
          disabled={isGenerating || (svgSource === 'upload' && !uploadedSvg)}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            isGenerating
              ? 'bg-slate-800 text-slate-500 cursor-wait'
              : svgSource === 'upload' && !uploadedSvg
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20'
          }`}
        >
          {isGenerating ? (
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
              Generujem výrobné STL...
            </>
          ) : svgSource === 'upload' && !uploadedSvg ? (
            <>📄 Najprv nahrajte SVG súbor</>
          ) : svgSource === 'upload' ? (
            <>🏭 Generovať STL z SVG</>
          ) : (
            <>🏭 Generovať výrobné STL</>
          )}
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
          <p className="font-medium mb-1">⚠ Chyba</p>
          <p className="whitespace-pre-line text-red-400/80">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#1a1a1a] rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-white">
                {result.totalParts}
              </div>
              <div className="text-[10px] text-slate-500">dielov</div>
            </div>
            <div className="bg-[#1a1a1a] rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-white">
                {Math.round(result.totalWeightG)}g
              </div>
              <div className="text-[10px] text-slate-500">hmotnosť</div>
            </div>
            <div className="bg-[#1a1a1a] rounded-lg p-2.5 text-center">
              <div className="text-lg font-bold text-white">
                {result.totalLedCount}
              </div>
              <div className="text-[10px] text-slate-500">LED modulov</div>
            </div>
          </div>

          {/* 3D STL Viewer – full view in main area */}
          {fullView && (
            <Suspense
              fallback={
                <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-8 text-center">
                  <div className="animate-spin h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full mx-auto mb-2" />
                  <p className="text-xs text-slate-500">Načítavam 3D náhľad...</p>
                </div>
              }
            >
              <STLViewer
                jobId={result.jobId}
                letters={result.letters}
                lightingType={result.lightingType}
                fullView={fullView}
              />
            </Suspense>
          )}

          {/* Sidebar: hint to use manufacturing tab */}
          {!fullView && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
              <p className="font-medium mb-1">👁️ 3D Náhľad výrobných dielov</p>
              <p className="text-emerald-400/70">
                Kliknite na tab <strong>&quot;🏭 Výrobné diely&quot;</strong> v hlavnom okne pre interaktívny 3D náhľad všetkých dielov s rozloženým pohľadom.
              </p>
            </div>
          )}

          {/* Per-letter breakdown */}
          <div className="space-y-1">
            {result.letters.map((letter, i) => (
              <div key={i} className="bg-[#1a1a1a] rounded-lg overflow-hidden">
                <button
                  onClick={() =>
                    setExpandedLetter(
                      expandedLetter === letter.char ? null : letter.char,
                    )
                  }
                  className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-[#f59e0b]">
                      {letter.char}
                    </span>
                    <span className="text-xs text-slate-500">
                      {letter.width_mm}×{letter.height_mm}mm ·{' '}
                      {letter.parts_count} dielov · {letter.weight_g}g
                    </span>
                  </div>
                  <span className="text-slate-600 text-xs">
                    {expandedLetter === letter.char ? '▲' : '▼'}
                  </span>
                </button>

                {expandedLetter === letter.char && (
                  <div className="px-3 pb-2 space-y-1">
                    {letter.parts.map((part, pi) => (
                      <div
                        key={pi}
                        className="flex items-start gap-2 text-xs py-1 border-t border-[#2a2a2a]"
                      >
                        <span className="text-base">
                          {PART_ICONS[part.part_type] || '📦'}
                        </span>
                        <div>
                          <p className="text-slate-300 font-medium">
                            {part.filename}
                          </p>
                          <p className="text-slate-500">{part.description}</p>
                        </div>
                      </div>
                    ))}
                    {letter.is_segmented && (
                      <div className="text-xs text-amber-400 mt-1">
                        ⚠ Segmentované: {letter.segment_count} dielov
                        (písmeno &gt; max veľkosť tlačiarne)
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Download button */}
          <button
            onClick={handleDownload}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-[#f59e0b] text-[#0a0a0a] hover:bg-[#d97706] transition-colors flex items-center justify-center gap-2"
          >
            📥 Stiahnuť ZIP ({result.totalParts} STL súborov)
          </button>

          {/* Bambu Lab Studio integrácia */}
          <Suspense
            fallback={
              <div className="glass rounded-xl p-5 text-xs text-slate-500 text-center">
                Načítavam Bambu Lab...
              </div>
            }
          >
            <BambuSend jobId={result.jobId} material="ASA" />
          </Suspense>

          {/* Regenerate */}
          <button
            onClick={() => {
              setResult(null);
              setError(null);
            }}
            className="w-full py-2 rounded-lg border border-[#2a2a2a] text-xs text-slate-500 hover:text-white hover:border-slate-500 transition-colors"
          >
            🔄 Pregenerovať s novými nastaveniami
          </button>

          {/* Change SVG source */}
          {svgSource === 'upload' && uploadedSvg && (
            <button
              onClick={handleClearSvg}
              className="w-full py-2 rounded-lg border border-[#2a2a2a] text-xs text-slate-500 hover:text-white hover:border-slate-500 transition-colors"
            >
              📄 Zmeniť SVG súbor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
