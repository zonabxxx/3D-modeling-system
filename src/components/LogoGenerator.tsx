'use client';

/**
 * LogoGenerator – AI generátor loga
 *
 * Umožňuje zadať názov firmy, zvoliť štýl a vygenerovať 4 varianty loga
 * cez Recraft V3 (SVG) alebo OpenAI (PNG).
 *
 * Vybrané logo sa automaticky importuje do konfigurátora.
 */

import { useState, useCallback } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { cleanSVG } from '@/lib/svg-utils';

// ───────────────────────────────────────────────
// Štýly loga
// ───────────────────────────────────────────────

const LOGO_STYLES = [
  { id: 'modern', label: 'Moderný', icon: '◆', desc: 'Čisté línie, geometria' },
  { id: 'minimal', label: 'Minimálny', icon: '○', desc: 'Ultra jednoduchý' },
  { id: 'retro', label: 'Retro', icon: '✦', desc: 'Vintage, klasický' },
  { id: 'luxury', label: 'Luxusný', icon: '♛', desc: 'Elegantný, prémiový' },
  { id: 'playful', label: 'Hravý', icon: '★', desc: 'Farebný, priateľský' },
  { id: 'industrial', label: 'Industriálny', icon: '⬡', desc: 'Silný, technický' },
  { id: 'nature', label: 'Príroda', icon: '🌿', desc: 'Organické tvary' },
] as const;

interface LogoVariant {
  url: string;
  svgUrl?: string; // vektorizované SVG (ak PNG bolo konvertované)
  svgContent?: string; // raw SVG obsah
  type: 'svg' | 'png';
  provider: string;
  vectorized?: boolean;
  vectorizeMethod?: string;
  width?: number;
  height?: number;
}

interface LogoGeneratorProps {
  onLogoSelected?: () => void; // callback po výbere loga
}

export default function LogoGenerator({ onLogoSelected }: LogoGeneratorProps) {
  const setLogoSVG = useConfiguratorStore((s) => s.setLogoSVG);
  const setLogoRaster = useConfiguratorStore((s) => s.setLogoRaster);
  const setContentType = useConfiguratorStore((s) => s.setContentType);

  const [businessName, setBusinessName] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('modern');
  const [variants, setVariants] = useState<LogoVariant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // ───────────────────────────────────────────────
  // Generovanie
  // ───────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!businessName.trim()) return;

    setIsGenerating(true);
    setError(null);
    setVariants([]);
    setSelectedIndex(null);
    setImportStatus(null);

    try {
      const res = await fetch('/api/generate-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName.trim(),
          style: selectedStyle,
          count: 4,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'no_api_keys') {
          setError(
            'AI generátor nie je nakonfigurovaný.\n\n' +
            'Nastavte v .env.local:\n' +
            '• RECRAFT_API_KEY=... (pre SVG logá)\n' +
            '• OPENAI_API_KEY=... (pre PNG logá)',
          );
        } else {
          setError(data.message || 'Generovanie zlyhalo. Skúste to znova.');
        }
        return;
      }

      setVariants(data.variants || []);
      if (data.variants?.length === 0) {
        setError('AI nevygenerovalo žiadne výsledky. Skúste iný štýl alebo názov.');
      }
    } catch (err) {
      console.error('Logo generation failed:', err);
      setError('Chyba pripojenia. Skontrolujte internet a skúste znova.');
    } finally {
      setIsGenerating(false);
    }
  }, [businessName, selectedStyle]);

  // ───────────────────────────────────────────────
  // Výber varianty → import do konfigurátora
  // ───────────────────────────────────────────────

  const handleSelectVariant = useCallback(
    async (variant: LogoVariant, index: number) => {
      setSelectedIndex(index);
      setImportStatus('Importujem logo...');

      try {
        // ── Priorita 1: Vektorizované SVG (z PNG→SVG pipeline) ──
        if (variant.vectorized && variant.svgContent) {
          const svgContent = variant.svgContent;
          const blob = new Blob([svgContent], { type: 'image/svg+xml' });
          const blobUrl = URL.createObjectURL(blob);
          
          setLogoSVG(blobUrl, svgContent, variant.width || 200, variant.height || 200);
          setContentType('logo_only');
          setImportStatus(
            `✅ Logo vektorizované (${variant.vectorizeMethod}) → 3D extrúzia ` +
            `(${variant.width?.toFixed(0)}×${variant.height?.toFixed(0)} mm)`
          );
          onLogoSelected?.();
          return;
        }

        // ── Priorita 2: Vektorizované SVG URL (fallback) ──
        if (variant.vectorized && variant.svgUrl) {
          let svgContent = '';
          if (variant.svgUrl.startsWith('data:image/svg+xml;base64,')) {
            const b64 = variant.svgUrl.replace('data:image/svg+xml;base64,', '');
            svgContent = atob(b64);
          }

          if (svgContent) {
            const blob = new Blob([svgContent], { type: 'image/svg+xml' });
            const blobUrl = URL.createObjectURL(blob);
            
            setLogoSVG(blobUrl, svgContent, variant.width || 200, variant.height || 200);
            setContentType('logo_only');
            setImportStatus('✅ Logo vektorizované → 3D extrúzia');
            onLogoSelected?.();
            return;
          }
        }

        // ── Priorita 3: Natívne SVG (z Recraft) ──
        if (variant.type === 'svg') {
          let svgContent = '';
          if (variant.url.startsWith('data:image/svg+xml;base64,')) {
            const b64 = variant.url.replace('data:image/svg+xml;base64,', '');
            svgContent = atob(b64);
          } else if (variant.url.startsWith('data:image/svg+xml')) {
            svgContent = decodeURIComponent(variant.url.split(',')[1] || '');
          }

          if (!svgContent) {
            setError('Nepodarilo sa extrahovať SVG obsah');
            setImportStatus(null);
            return;
          }

          // Vyčistiť SVG
          const cleaned = await cleanSVG(svgContent);
          const blob = new Blob([cleaned.svg], { type: 'image/svg+xml' });
          const blobUrl = URL.createObjectURL(blob);

          setLogoSVG(blobUrl, cleaned.svg, cleaned.width, cleaned.height);
          setContentType('logo_only');
          setImportStatus('✅ SVG logo importované (3D extrúzia)');
        } else {
          // ── PNG/raster: konvertovať data URL → blob, importovať ──
          const img = document.createElement('img');

          img.onload = () => {
            try {
              let blobUrl = variant.url;
              let file: File | null = null;

              if (variant.url.startsWith('data:')) {
                const parts = variant.url.split(',');
                const mimeMatch = parts[0].match(/:(.*?);/);
                const mime = mimeMatch?.[1] || 'image/png';
                const byteString = atob(parts[1]);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mime });
                file = new File([blob], `ai-logo-${Date.now()}.png`, { type: mime });
                blobUrl = URL.createObjectURL(blob);
              }

              if (file) {
                setLogoRaster(blobUrl, file, img.naturalWidth, img.naturalHeight);
              }
              setContentType('logo_only');
              setImportStatus('✅ PNG logo importované (reliéf – bez vektorizácie)');
            } catch (err) {
              console.error('Failed to import raster logo:', err);
              setError('Chyba pri importe obrázka');
              setImportStatus(null);
            }
          };

          img.onerror = () => {
            setError('Nepodarilo sa načítať vygenerovaný obrázok');
            setImportStatus(null);
          };

          img.src = variant.url;
        }
      } catch (err) {
        console.error('Logo import failed:', err);
        setError('Chyba pri importe loga');
        setImportStatus(null);
      }

      onLogoSelected?.();
    },
    [setLogoSVG, setLogoRaster, setContentType, onLogoSelected],
  );

  // ───────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Názov firmy */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Názov firmy / text loga
        </label>
        <input
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="napr. AROMA Café"
          className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:border-[#f59e0b] focus:outline-none transition-colors text-lg"
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && businessName.trim()) handleGenerate();
          }}
        />
      </div>

      {/* Výber štýlu */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Štýl loga
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {LOGO_STYLES.map(({ id, label, icon, desc }) => (
            <button
              key={id}
              onClick={() => setSelectedStyle(id)}
              className={`p-3 rounded-xl border text-center transition-all ${
                selectedStyle === id
                  ? 'border-[#f59e0b] bg-[#f59e0b]/10'
                  : 'border-[#2a2a2a] hover:border-slate-600'
              }`}
            >
              <div className="text-lg mb-0.5">{icon}</div>
              <div className="text-xs font-medium text-white">{label}</div>
              <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                {desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tlačidlo generovania */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !businessName.trim()}
        className={`w-full py-3.5 rounded-xl font-semibold text-base transition-all flex items-center justify-center gap-2 ${
          isGenerating || !businessName.trim()
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg shadow-purple-500/20'
        }`}
      >
        {isGenerating ? (
          <>
            <svg
              className="animate-spin h-5 w-5"
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
            Generujem logá... (10–30s)
          </>
        ) : (
          <>
            ✨ Vygenerovať logo cez AI
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-medium mb-1">Chyba generovania</p>
              <p className="text-red-400/80 whitespace-pre-line">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Výsledky – grid 2×2 */}
      {variants.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-3">
            Vyber logo ({variants[0]?.vectorized ? 'PNG → SVG → 3D extrúzia' : variants[0]?.type === 'svg' ? 'SVG → 3D extrúzia' : 'PNG'})
          </label>
          <div className="grid grid-cols-2 gap-3">
            {variants.map((variant, i) => (
              <button
                key={i}
                onClick={() => handleSelectVariant(variant, i)}
                className={`relative rounded-xl border-2 overflow-hidden transition-all group ${
                  selectedIndex === i
                    ? 'border-[#f59e0b] ring-2 ring-[#f59e0b]/30 scale-[1.02]'
                    : 'border-[#2a2a2a] hover:border-slate-500'
                }`}
              >
                <div className="bg-white/95 p-3 aspect-square flex items-center justify-center">
                  {/* Pre preview zobrazíme PNG (vyzerá lepšie), importujeme SVG */}
                  <img
                    src={variant.url}
                    alt={`Logo variant ${i + 1}`}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>

                {/* Badge */}
                <div className="absolute top-2 right-2 flex gap-1">
                  {variant.vectorized && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/90 text-white">
                      Vektorizované
                    </span>
                  )}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      variant.type === 'svg' || variant.vectorized
                        ? 'bg-green-500/90 text-white'
                        : 'bg-blue-500/90 text-white'
                    }`}
                  >
                    {variant.vectorized ? 'SVG' : variant.type === 'svg' ? 'SVG' : 'PNG'}
                  </span>
                </div>

                {/* Provider badge */}
                <div className="absolute bottom-2 right-2">
                  <span className="px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-white/70">
                    {variant.provider === 'recraft' ? '🎨 Recraft' : '🤖 OpenAI'}
                  </span>
                </div>

                {/* Selected checkmark */}
                {selectedIndex === i && (
                  <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-[#f59e0b] flex items-center justify-center">
                    <span className="text-[#0a0a0a] text-sm font-bold">✓</span>
                  </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-[#f59e0b]/0 group-hover:bg-[#f59e0b]/5 transition-colors" />
              </button>
            ))}
          </div>

          {/* Import status */}
          {importStatus && (
            <p className="text-center text-sm text-[#f59e0b] mt-3 animate-fade-in-up">
              {importStatus}
            </p>
          )}

          {/* Regenerovať */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mt-3 w-full py-2 rounded-lg border border-[#2a2a2a] text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
          >
            🔄 Vygenerovať nové varianty
          </button>
        </div>
      )}
    </div>
  );
}
