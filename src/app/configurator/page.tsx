'use client';

/**
 * Hlavná stránka konfigurátora
 * 
 * 5-krokový wizard: Upload → Obsah (Text/Logo) → Mierka → 3D Náhľad → Objednávka
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { STEP_ORDER, STEP_LABELS, LOGO_PLACEMENT_LABELS } from '@/types/configurator';
import type { ConfiguratorStep, ContentType, LogoPlacement, Point2D } from '@/types/configurator';
import FontSelector from '@/components/FontSelector';
import ColorPicker from '@/components/ColorPicker';
import { cleanSVG, svgToTransparentPngUrl } from '@/lib/svg-utils';
import PriceDisplay from '@/components/PriceDisplay';
import LogoGenerator from '@/components/LogoGenerator';
import STLDownload from '@/components/STLDownload';

// Dynamické importy (SSR off)
const FacadePreview = dynamic(() => import('@/components/FacadePreview'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🏠</div>
      </div>
    </div>
  ),
});

const Scene3D = dynamic(() => import('@/components/Scene3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🏗️</div>
        <p className="text-slate-500 text-sm">Načítavam 3D scénu s fasádou...</p>
      </div>
    </div>
  ),
});

const Scene3DDetail = dynamic(() => import('@/components/Scene3DDetail'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-pulse">🧊</div>
        <p className="text-slate-500 text-sm">Načítavam 3D detail...</p>
      </div>
    </div>
  ),
});

export default function ConfiguratorPage() {
  const currentStep = useConfiguratorStore((s) => s.currentStep);
  const setStep = useConfiguratorStore((s) => s.setStep);
  const text = useConfiguratorStore((s) => s.text);
  const photoUrl = useConfiguratorStore((s) => s.photo.url);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);

  // Preview label: text + logo info
  const previewLabel = contentType === 'logo_only'
    ? (logo.svgUrl || logo.rasterUrl ? 'Logo nahrané' : '')
    : text;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[#2a2a2a] px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#f59e0b] to-[#d97706] rounded-xl flex items-center justify-center">
              <span className="text-[#0a0a0a] font-bold text-lg">A</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">3D Konfigurátor</h1>
              <p className="text-xs text-slate-500">Svetelné reklamy na mieru</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {previewLabel && (
              <div className="hidden md:block text-right">
                <p className="text-sm text-slate-400">
                  {contentType === 'logo_only' ? 'Logo:' : 'Náhľad:'}
                </p>
                <p className="text-lg font-bold text-[#f59e0b]">{previewLabel}</p>
              </div>
            )}
            <Link
              href="/settings"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a1a1a] transition-colors"
              title="Výrobné nastavenia"
            >
              ⚙️
            </Link>
          </div>
        </div>
      </header>

      {/* Stepper */}
      <nav className="border-b border-[#2a2a2a] px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {STEP_ORDER.map((step, index) => (
            <StepIndicator
              key={step}
              step={step}
              index={index}
              currentStep={currentStep}
              isClickable={canNavigateToStep(step, currentStep, !!photoUrl)}
              onClick={() => {
                if (canNavigateToStep(step, currentStep, !!photoUrl)) {
                  setStep(step);
                }
              }}
            />
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <StepContent step={currentStep} />
        </div>
      </main>
    </div>
  );
}

function StepIndicator({
  step,
  index,
  currentStep,
  isClickable,
  onClick,
}: {
  step: ConfiguratorStep;
  index: number;
  currentStep: ConfiguratorStep;
  isClickable: boolean;
  onClick: () => void;
}) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const isActive = step === currentStep;
  const isCompleted = index < currentIndex;

  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      className={`flex items-center gap-2 transition-all ${
        isClickable ? 'cursor-pointer' : 'cursor-default'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
          isActive
            ? 'border-[#f59e0b] bg-[#f59e0b]/10 text-[#f59e0b]'
            : isCompleted
            ? 'border-green-500 bg-green-500/10 text-green-500'
            : 'border-slate-700 text-slate-600'
        }`}
      >
        {isCompleted ? '✓' : index + 1}
      </div>
      <span
        className={`hidden sm:block text-sm font-medium ${
          isActive
            ? 'text-[#f59e0b]'
            : isCompleted
            ? 'text-green-500'
            : 'text-slate-600'
        }`}
      >
        {STEP_LABELS[step]}
      </span>

      {/* Connector line */}
      {index < STEP_ORDER.length - 1 && (
        <div
          className={`hidden sm:block w-8 md:w-16 h-0.5 mx-2 ${
            isCompleted ? 'bg-green-500/50' : 'bg-slate-800'
          }`}
        />
      )}
    </button>
  );
}

function StepContent({ step }: { step: ConfiguratorStep }) {
  switch (step) {
    case 'upload':
      return <UploadStepPlaceholder />;
    case 'content':
      return <ContentStep />;
    case 'scale':
      return <ScaleStepPlaceholder />;
    case 'preview':
      return <PreviewStepPlaceholder />;
    case 'order':
      return <OrderStepPlaceholder />;
    default:
      return null;
  }
}

// === Upload Step ===

function UploadStepPlaceholder() {
  const setPhoto = useConfiguratorStore((s) => s.setPhoto);
  const photo = useConfiguratorStore((s) => s.photo);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.heic')) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Súbor je väčší ako 10 MB. Prosím, zmenši rozlíšenie.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPhoto(url, img.naturalWidth, img.naturalHeight, file);
    };
    img.src = url;
  }, [setPhoto]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="max-w-2xl mx-auto text-center">
      <h2 className="text-2xl font-bold text-white mb-2">Nahraj fotku fasády</h2>
      <p className="text-slate-400 mb-8">
        Odfoť fasádu mobilom alebo nahraj existujúcu fotku budovy.
      </p>

      {!photo.url ? (
        <label
          className={`block glass rounded-2xl p-16 border-2 border-dashed cursor-pointer transition-all ${
            isDragging
              ? 'border-[#f59e0b] bg-[#f59e0b]/5 scale-[1.01]'
              : 'border-slate-700 hover:border-[#f59e0b]/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="text-6xl mb-4">{isDragging ? '📥' : '📸'}</div>
          <p className="text-lg font-medium text-white mb-2">
            {isDragging ? 'Pusti pre nahranie' : 'Klikni alebo pretiahni fotku'}
          </p>
          <p className="text-sm text-slate-500">JPG, PNG, HEIC · Max 10 MB</p>
          <p className="text-xs text-slate-600 mt-4">
            💡 Tip: Foť fasádu priamo z ulice, pokiaľ možno rovnobežne
          </p>
        </label>
      ) : (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-[#2a2a2a]">
            <img
              src={photo.url}
              alt="Fasáda"
              className="w-full max-h-[500px] object-contain bg-black"
            />
            <div className="absolute top-4 right-4">
              <button
                onClick={() => useConfiguratorStore.getState().clearPhoto()}
                className="px-3 py-1.5 rounded-lg bg-red-500/80 text-white text-sm hover:bg-red-600 transition-colors"
              >
                ✕ Odstrániť
              </button>
            </div>
            {/* Photo info badge */}
            <div className="absolute bottom-4 left-4">
              <span className="px-2.5 py-1 rounded-lg bg-black/70 text-slate-300 text-xs backdrop-blur-sm">
                {photo.width} × {photo.height} px ·{' '}
                {photo.file ? `${(photo.file.size / 1024 / 1024).toFixed(1)} MB` : ''}
              </span>
            </div>
          </div>
          <p className="text-sm text-slate-400">
            💡 V ďalšom kroku nastavíš text, logo a štýl nápisu
          </p>
          <button
            onClick={nextStep}
            className="px-8 py-3 rounded-xl btn-orange text-lg"
          >
            Pokračovať →
          </button>
        </div>
      )}
    </div>
  );
}

// ==================================================================
// CONTENT STEP – Text + Logo (hlavná zmena)
// ==================================================================

function ContentStep() {
  const contentType = useConfiguratorStore((s) => s.contentType);
  const setContentType = useConfiguratorStore((s) => s.setContentType);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const prevStep = useConfiguratorStore((s) => s.prevStep);
  const text = useConfiguratorStore((s) => s.text);
  const logo = useConfiguratorStore((s) => s.logo);

  // Can proceed?
  const hasText = text.trim().length > 0;
  const hasLogo = !!(logo.svgUrl || logo.rasterUrl);
  const canProceed =
    (contentType === 'text_only' && hasText) ||
    (contentType === 'logo_only' && hasLogo) ||
    (contentType === 'text_and_logo' && hasText && hasLogo);

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Obsah a štýl</h2>

      <div className="space-y-6">
        {/* === Výber typu obsahu === */}
        <div className="glass rounded-xl p-6">
          <label className="block text-sm font-medium text-slate-300 mb-4">
            Čo chceš na fasáde?
          </label>
          <div className="grid grid-cols-3 gap-3">
            {([
              { type: 'text_only' as ContentType, label: 'Iba text', icon: '🔤', desc: '3D písmená' },
              { type: 'logo_only' as ContentType, label: 'Iba logo', icon: '🖼️', desc: 'SVG alebo obrázok' },
              { type: 'text_and_logo' as ContentType, label: 'Text + Logo', icon: '✨', desc: 'Kombinácia' },
            ]).map(({ type, label, icon, desc }) => (
              <button
                key={type}
                onClick={() => setContentType(type)}
                className={`p-4 rounded-xl border-2 text-center transition-all ${
                  contentType === type
                    ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                    : 'border-[#2a2a2a] hover:border-slate-600'
                }`}
              >
                <div className="text-2xl mb-1">{icon}</div>
                <div className="text-sm font-medium text-white">{label}</div>
                <div className="text-xs text-slate-500">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* === Text konfigurácia (ak text_only alebo text_and_logo) === */}
        {contentType !== 'logo_only' && <TextConfigSection />}
        {contentType !== 'logo_only' && <FontSelector />}

        {/* === Logo konfigurácia (ak logo_only alebo text_and_logo) === */}
        {contentType !== 'text_only' && <LogoConfigSection />}

        {/* === Mini náhľad na fasáde – okamžitá vizuálna spätná väzba === */}
        {(hasText || hasLogo) && <ContentPreviewMini />}

        {/* === Spoločné nastavenia: Profil + Hĺbka + Podsvietenie === */}
        <ProfileSection />
        <DepthSection />
        <LightingSection />
        <ColorPicker />

        {/* Navigation */}
        <div className="flex justify-between pt-4">
          <button onClick={prevStep} className="px-6 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
            ← Späť
          </button>
          <button
            onClick={nextStep}
            disabled={!canProceed}
            className="px-8 py-3 rounded-xl btn-orange disabled:opacity-50"
          >
            Pokračovať →
          </button>
        </div>
      </div>
    </div>
  );
}

// === Text Section ===

function TextConfigSection() {
  const text = useConfiguratorStore((s) => s.text);
  const setText = useConfiguratorStore((s) => s.setText);

  return (
    <div className="glass rounded-xl p-6">
      <label className="block text-sm font-medium text-slate-300 mb-2">
        Názov / Text nápisu
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="napr. ADSUN"
        maxLength={50}
        className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white text-2xl font-bold placeholder-slate-600 focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/20 outline-none transition-all"
      />
      <p className="text-xs text-slate-500 mt-2">
        {text.length}/50 znakov · {text.replace(/\s/g, '').length} písmen
      </p>
    </div>
  );
}

// === Logo Section ===

function LogoConfigSection() {
  const logo = useConfiguratorStore((s) => s.logo);
  const setLogoSVG = useConfiguratorStore((s) => s.setLogoSVG);
  const setLogoRaster = useConfiguratorStore((s) => s.setLogoRaster);
  const setLogoPlacement = useConfiguratorStore((s) => s.setLogoPlacement);
  const setLogoScale = useConfiguratorStore((s) => s.setLogoScale);
  const setLogoExtrudeAsRelief = useConfiguratorStore((s) => s.setLogoExtrudeAsRelief);
  const setLogoReliefDepth = useConfiguratorStore((s) => s.setLogoReliefDepth);
  const clearLogo = useConfiguratorStore((s) => s.clearLogo);
  const contentType = useConfiguratorStore((s) => s.contentType);

  const [logoTab, setLogoTab] = useState<'upload' | 'ai'>('upload');

  const hasLogo = !!(logo.svgUrl || logo.rasterUrl);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isSVG = file.type === 'image/svg+xml' || file.name.endsWith('.svg');

    if (isSVG) {
      // SVG — prečítaj a vyčisti
      const rawText = await file.text();
      const url = URL.createObjectURL(file);

      // Vyčisti SVG — odstráň biele pozadie, nájdi rozmery obsahu
      const result = await cleanSVG(rawText);

      console.log(`[Logo Upload] Clean SVG: ${Math.round(result.width)}×${Math.round(result.height)}`);

      setLogoSVG(url, result.svg, result.width, result.height);
    } else {
      // Raster (PNG/JPG)
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setLogoRaster(url, file, img.naturalWidth, img.naturalHeight);
      };
      img.src = url;
    }
  };

  return (
    <div className="glass rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-300">
          Logo
        </label>
        {hasLogo && (
          <button
            onClick={clearLogo}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            ✕ Odstrániť logo
          </button>
        )}
      </div>

      {/* === Tabs: Nahrať / AI Generovať === */}
      {!hasLogo && (
        <div className="flex gap-1 bg-[#111] rounded-xl p-1">
          <button
            onClick={() => setLogoTab('upload')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              logoTab === 'upload'
                ? 'bg-[#1e1e1e] text-white shadow'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            📁 Nahrať vlastné
          </button>
          <button
            onClick={() => setLogoTab('ai')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              logoTab === 'ai'
                ? 'bg-gradient-to-r from-purple-600/20 to-blue-600/20 text-purple-300 shadow'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            ✨ AI Generovať
          </button>
        </div>
      )}

      {/* Upload tab */}
      {!hasLogo && logoTab === 'upload' ? (
        <label className="block rounded-xl p-8 border-2 border-dashed border-slate-700 hover:border-[#f59e0b]/50 cursor-pointer transition-colors text-center">
          <input
            type="file"
            accept=".svg,image/svg+xml,image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleLogoUpload}
          />
          <div className="text-4xl mb-3">🖼️</div>
          <p className="text-sm font-medium text-white mb-1">
            Nahraj logo
          </p>
          <p className="text-xs text-slate-500">
            SVG (najlepšie pre 3D) · PNG, JPG (ako reliéf)
          </p>
          <p className="text-xs text-[#f59e0b] mt-2">
            💡 SVG súbor sa skonvertuje na plné 3D písmená/tvary
          </p>
        </label>
      ) : !hasLogo && logoTab === 'ai' ? (
        /* AI Generator tab */
        <LogoGenerator onLogoSelected={() => {}} />
      ) : (
        <div className="space-y-4">
          {/* Preview loga */}
          <div className="relative rounded-xl overflow-hidden border border-[#2a2a2a] bg-slate-900/50 p-4 flex items-center justify-center min-h-[120px]">
            {(logo.svgContent || logo.svgUrl) && (
              <img
                src={logo.svgContent ? ('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logo.svgContent)) : logo.svgUrl!}
                alt="Logo (SVG)"
                className="max-h-[120px] max-w-full object-contain"
              />
            )}
            {logo.rasterUrl && (
              <img
                src={logo.rasterUrl}
                alt="Logo (raster)"
                className="max-h-[120px] max-w-full object-contain"
              />
            )}
            <div className="absolute top-2 right-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                logo.sourceType === 'svg'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {logo.sourceType === 'svg' ? 'SVG → 3D' : 'Raster → Reliéf'}
              </span>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            {Math.round(logo.originalWidth)} × {Math.round(logo.originalHeight)}{' '}
            {logo.sourceType === 'svg' ? 'SVG units' : 'px'}
            {logo.sourceType === 'svg' && logo.originalWidth > 0 && logo.originalHeight > 0 && (
              <span className="ml-2 text-slate-600">
                (pomer strán {(logo.originalWidth / logo.originalHeight).toFixed(2)}:1)
              </span>
            )}
          </div>

          {/* 3D metóda pre logo */}
          {logo.sourceType === 'svg' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                3D metóda
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLogoExtrudeAsRelief(false)}
                  className={`p-3 rounded-lg border text-left text-xs transition-all ${
                    !logo.extrudeAsRelief
                      ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                      : 'border-[#2a2a2a] hover:border-slate-600'
                  }`}
                >
                  <div className="font-medium text-white">🧊 Plná 3D extrúzia</div>
                  <div className="text-slate-500 mt-0.5">Vektorové tvary extrudované do 3D</div>
                </button>
                <button
                  onClick={() => setLogoExtrudeAsRelief(true)}
                  className={`p-3 rounded-lg border text-left text-xs transition-all ${
                    logo.extrudeAsRelief
                      ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                      : 'border-[#2a2a2a] hover:border-slate-600'
                  }`}
                >
                  <div className="font-medium text-white">📐 Reliéf / doska</div>
                  <div className="text-slate-500 mt-0.5">Plochý panel s logom</div>
                </button>
              </div>
            </div>
          )}

          {/* Relief depth */}
          {logo.extrudeAsRelief && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                Hĺbka reliéfu: <span className="text-[#f59e0b]">{logo.reliefDepthMm} mm</span>
              </label>
              <input
                type="range"
                min={2}
                max={30}
                value={logo.reliefDepthMm}
                onChange={(e) => setLogoReliefDepth(Number(e.target.value))}
                className="w-full accent-[#f59e0b]"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>2 mm</span>
                <span>30 mm</span>
              </div>
            </div>
          )}

          {/* Pozícia loga voči textu */}
          {contentType === 'text_and_logo' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                Pozícia loga voči textu
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(LOGO_PLACEMENT_LABELS) as [LogoPlacement, string][])
                  .filter(([key]) => key !== 'standalone') // standalone = logo_only
                  .map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setLogoPlacement(key)}
                      className={`p-2 rounded-lg border text-xs text-center transition-all ${
                        logo.logoPlacement === key
                          ? 'border-[#f59e0b] bg-[#f59e0b]/5 text-white'
                          : 'border-[#2a2a2a] text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Veľkosť loga */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Veľkosť loga: <span className="text-[#f59e0b]">{Math.round(logo.logoScale * 100)}%</span>
            </label>
            <input
              type="range"
              min={10}
              max={300}
              value={Math.round(logo.logoScale * 100)}
              onChange={(e) => setLogoScale(Number(e.target.value) / 100)}
              className="w-full accent-[#f59e0b]"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              <span>10%</span>
              <span>300%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// === Mini náhľad na fasáde (v Content Step) ===

function ContentPreviewMini() {
  const photo = useConfiguratorStore((s) => s.photo);
  const text = useConfiguratorStore((s) => s.text);
  const fontFamily = useConfiguratorStore((s) => s.fontFamily);
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const position = useConfiguratorStore((s) => s.position);

  const showText = contentType !== 'logo_only' && text.length > 0;
  const showLogo = contentType !== 'text_only' && !!(logo.svgUrl || logo.rasterUrl || logo.svgContent);

  // SVG logo src (transparentné PNG pre spoľahlivé zobrazenie bez bieleho pozadia)
  const [logoSrc, setMiniLogoSrc] = useState<string | null>(
    logo.svgUrl || logo.rasterUrl || null
  );
  useEffect(() => {
    if (logo.svgContent) {
      svgToTransparentPngUrl(logo.svgContent, 512).then(setMiniLogoSrc);
    } else {
      setMiniLogoSrc(logo.svgUrl || logo.rasterUrl || null);
    }
  }, [logo.svgContent, logo.svgUrl, logo.rasterUrl]);

  if (!photo.url) return null;
  if (!showText && !showLogo) return null;

  return (
    <div className="glass rounded-xl p-4">
      <label className="block text-xs font-medium text-slate-400 mb-2">
        📷 Náhľad na fasáde
      </label>
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ maxHeight: 280 }}>
        <img
          src={photo.url}
          alt="Fasáda"
          className="w-full object-contain pointer-events-none"
          style={{ maxHeight: 260 }}
          draggable={false}
        />
        {/* Overlay: text + logo */}
        <div
          className="absolute"
          style={{
            left: `${position.x * 100}%`,
            top: `${position.y * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Logo (standalone alebo nad textom) */}
          {showLogo && (!showText || logo.logoPlacement === 'above_text') && logoSrc && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: showText ? 2 : 0 }}>
              <img
                src={logoSrc}
                alt="Logo"
                style={{ height: 40, maxWidth: 120, objectFit: 'contain', pointerEvents: 'none' }}
                draggable={false}
              />
            </div>
          )}
          <div className="flex items-center gap-1">
            {showLogo && showText && logo.logoPlacement === 'left_of_text' && logoSrc && (
              <img src={logoSrc} alt="" style={{ height: 32, objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />
            )}
            {showText && (
              <div
                style={{
                  fontFamily: `'${fontFamily}', sans-serif`,
                  fontSize: 22,
                  fontWeight: 700,
                  color: faceColor,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.1,
                  letterSpacing: '0.02em',
                  userSelect: 'none',
                }}
              >
                {text}
              </div>
            )}
            {showLogo && showText && logo.logoPlacement === 'right_of_text' && logoSrc && (
              <img src={logoSrc} alt="" style={{ height: 32, objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />
            )}
          </div>
          {showLogo && showText && logo.logoPlacement === 'below_text' && logoSrc && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
              <img src={logoSrc} alt="" style={{ height: 32, objectFit: 'contain', pointerEvents: 'none' }} draggable={false} />
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-600 mt-2 text-center">
        Náhľad • Presná pozícia sa nastavuje v kroku Náhľad
      </p>
    </div>
  );
}

// === Profile Section ===

function ProfileSection() {
  const profileType = useConfiguratorStore((s) => s.profileType);
  const setProfileType = useConfiguratorStore((s) => s.setProfileType);

  return (
    <div className="glass rounded-xl p-6">
      <label className="block text-sm font-medium text-slate-300 mb-4">3D Profil</label>
      <div className="grid grid-cols-3 gap-3">
        {(['flat', 'rounded', 'chamfer'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setProfileType(type)}
            className={`profile-option ${profileType === type ? 'selected' : ''}`}
          >
            <div className="text-2xl mb-2">
              {type === 'flat' ? '▬' : type === 'rounded' ? '⬭' : '⬠'}
            </div>
            <div className="text-sm font-medium text-white">
              {type === 'flat' ? 'Rovný' : type === 'rounded' ? 'Zaoblený' : 'Skosený'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// === Depth Section ===

function DepthSection() {
  const depthMm = useConfiguratorStore((s) => s.depthMm);
  const setDepthMm = useConfiguratorStore((s) => s.setDepthMm);

  return (
    <div className="glass rounded-xl p-6">
      <label className="block text-sm font-medium text-slate-300 mb-4">
        Hĺbka: <span className="text-[#f59e0b] font-bold">{depthMm} mm</span>
      </label>
      <div className="flex gap-2">
        {[30, 50, 80, 100, 150].map((d) => (
          <button
            key={d}
            onClick={() => setDepthMm(d)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              depthMm === d
                ? 'bg-[#f59e0b] text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {d}mm
          </button>
        ))}
      </div>
    </div>
  );
}

// === Lighting Section – vizuálne karty podsvietenia ===

const LIGHTING_OPTIONS = [
  {
    type: 'none' as const,
    label: 'Bez podsvitu',
    desc: 'Plné 3D písmená bez LED. Elegantný denný vzhľad.',
    gradient: 'from-slate-700 to-slate-800',
    borderActive: 'border-slate-400',
    preview: (
      <div className="relative w-full h-12 flex items-center justify-center">
        <div className="text-2xl font-black text-slate-300 tracking-wider" style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>ABC</div>
      </div>
    ),
  },
  {
    type: 'front' as const,
    label: 'Front-lit',
    desc: 'LED svietia cez opálové čelo. Jasný, viditeľný aj v noci.',
    gradient: 'from-amber-600/30 to-amber-900/10',
    borderActive: 'border-amber-400',
    preview: (
      <div className="relative w-full h-12 flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-radial from-amber-400/30 via-transparent to-transparent rounded" />
        <div className="text-2xl font-black text-amber-200 tracking-wider" style={{ textShadow: '0 0 20px rgba(251,191,36,0.8), 0 0 40px rgba(251,191,36,0.4)' }}>ABC</div>
      </div>
    ),
  },
  {
    type: 'halo' as const,
    label: 'Halo (zadné)',
    desc: 'LED svietia dozadu na stenu. Elegantný svetelný obrys.',
    gradient: 'from-blue-600/20 to-blue-900/5',
    borderActive: 'border-blue-400',
    preview: (
      <div className="relative w-full h-12 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3/4 h-8 bg-gradient-radial from-blue-400/25 via-blue-400/10 to-transparent rounded-lg blur-sm" />
        </div>
        <div className="text-2xl font-black text-slate-200 tracking-wider relative" style={{ textShadow: '0 0 15px rgba(96,165,250,0.6), 0 0 30px rgba(96,165,250,0.3)' }}>ABC</div>
      </div>
    ),
  },
  {
    type: 'front_halo' as const,
    label: 'DUO (front + halo)',
    desc: 'Kombinácia predného aj zadného. Maximálny vizuálny efekt.',
    gradient: 'from-purple-600/20 via-amber-600/15 to-purple-900/5',
    borderActive: 'border-purple-400',
    preview: (
      <div className="relative w-full h-12 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3/4 h-8 bg-gradient-radial from-purple-400/20 via-transparent to-transparent rounded-lg blur-sm" />
        </div>
        <div className="absolute inset-0 bg-gradient-radial from-amber-400/15 via-transparent to-transparent rounded" />
        <div className="text-2xl font-black text-amber-100 tracking-wider relative" style={{ textShadow: '0 0 18px rgba(251,191,36,0.7), 0 0 35px rgba(168,85,247,0.5)' }}>ABC</div>
      </div>
    ),
  },
];

function LightingSection() {
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const setLightingType = useConfiguratorStore((s) => s.setLightingType);

  return (
    <div className="glass rounded-xl p-6">
      <label className="block text-sm font-medium text-slate-300 mb-4">Podsvietenie</label>
      <div className="grid grid-cols-1 gap-3">
        {LIGHTING_OPTIONS.map(({ type, label, desc, gradient, borderActive, preview }) => (
          <button
            key={type}
            onClick={() => setLightingType(type)}
            className={`relative overflow-hidden rounded-xl border-2 text-left transition-all duration-200 ${
              lightingType === type
                ? `${borderActive} bg-gradient-to-r ${gradient} shadow-lg`
                : 'border-[#2a2a2a] hover:border-slate-600 bg-[#111]'
            }`}
          >
            {/* Vizuálny preview */}
            <div className={`px-4 pt-3 pb-1 bg-gradient-to-r ${gradient} rounded-t-lg`}>
              {preview}
            </div>

            {/* Text */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                {lightingType === type && (
                  <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
                )}
                <span className="text-sm font-semibold text-white">{label}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ==================================================================
// SCALE STEP – Referenčné meranie na fotke + výška písmen
// ==================================================================

function ScaleStepPlaceholder() {
  const photo = useConfiguratorStore((s) => s.photo);
  const scale = useConfiguratorStore((s) => s.scale);
  const setScalePoints = useConfiguratorStore((s) => s.setScalePoints);
  const setScaleRealMm = useConfiguratorStore((s) => s.setScaleRealMm);
  const clearScale = useConfiguratorStore((s) => s.clearScale);
  const computed = useConfiguratorStore((s) => s.computed);
  const setComputed = useConfiguratorStore((s) => s.setComputed);
  const text = useConfiguratorStore((s) => s.text);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const prevStep = useConfiguratorStore((s) => s.prevStep);

  // Lokálny stav pre interakciu
  const [mode, setMode] = useState<'idle' | 'point1' | 'point2' | 'done'>(
    scale.point1 && scale.point2 ? 'done' : 'idle'
  );
  const [tempPoint1, setTempPoint1] = useState<Point2D | null>(scale.point1);
  const [tempPoint2, setTempPoint2] = useState<Point2D | null>(scale.point2);
  const [realCm, setRealCm] = useState<string>(
    scale.realMm ? String(Math.round(scale.realMm / 10)) : ''
  );
  const [refLabel, setRefLabel] = useState<string>('Šírka dverí');
  const [letterHeightInput, setLetterHeightInput] = useState<string>(
    computed.letterHeightMm > 0 ? String(Math.round(computed.letterHeightMm)) : '200'
  );

  const imgRef = useRef<HTMLImageElement>(null);

  // Vypočítaj pixel vzdialenosť
  const pixelDist = tempPoint1 && tempPoint2
    ? Math.sqrt(
        Math.pow(tempPoint2.x - tempPoint1.x, 2) +
        Math.pow(tempPoint2.y - tempPoint1.y, 2)
      )
    : 0;

  // Faktor px → mm
  const realMm = realCm ? parseFloat(realCm) * 10 : 0;
  const factor = pixelDist > 0 && realMm > 0 ? realMm / pixelDist : null;

  // Výška písmen v mm
  const letterHeightMm = parseFloat(letterHeightInput) || 200;

  // Handler pre kliknutie na fotku
  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (mode !== 'point1' && mode !== 'point2') return;

      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      // Prepočet na pôvodné rozmery obrázka
      const scaleX = photo.width / rect.width;
      const scaleY = photo.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const point: Point2D = { x: Math.round(x), y: Math.round(y) };

      if (mode === 'point1') {
        setTempPoint1(point);
        setMode('point2');
      } else if (mode === 'point2') {
        setTempPoint2(point);
        setMode('done');
        // Ulož do store
        if (tempPoint1) {
          setScalePoints(tempPoint1, point);
        }
      }
    },
    [mode, photo.width, photo.height, tempPoint1, setScalePoints]
  );

  // Keď sa zmení reálna hodnota, ulož do store
  useEffect(() => {
    if (realMm > 0 && tempPoint1 && tempPoint2) {
      setScaleRealMm(realMm);
    }
  }, [realMm, tempPoint1, tempPoint2, setScaleRealMm]);

  // Keď sa zmení výška písmen, ulož do store
  useEffect(() => {
    if (letterHeightMm > 0) {
      setComputed({ letterHeightMm });
    }
  }, [letterHeightMm, setComputed]);

  // Reset merania
  const handleReset = () => {
    setTempPoint1(null);
    setTempPoint2(null);
    setRealCm('');
    setMode('idle');
    clearScale();
  };

  // Bežné referenčné rozmery
  const presets = [
    { label: 'Šírka dverí', cm: 90 },
    { label: 'Výška dverí', cm: 200 },
    { label: 'Šírka okna', cm: 120 },
    { label: 'Výška výkladu', cm: 250 },
    { label: '1 meter', cm: 100 },
  ];

  // Odporúčané výšky písmen
  const heightPresets = [
    { label: '100 mm', mm: 100, desc: 'Malé – interiér' },
    { label: '200 mm', mm: 200, desc: 'Stredné' },
    { label: '300 mm', mm: 300, desc: 'Štandard exteriér' },
    { label: '500 mm', mm: 500, desc: 'Veľké' },
    { label: '800 mm', mm: 800, desc: 'Extra veľké' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-2">Reálne rozmery</h2>
      <p className="text-slate-400 mb-6">
        Označ na fotke referenčný rozmer a nastav požadovanú výšku písmen.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* === Ľavá strana: Fotka s meracími bodmi === */}
        <div className="lg:col-span-2 space-y-4">
          {/* Inštrukcie */}
          <div className={`glass rounded-xl p-4 text-sm transition-all ${
            mode === 'point1' || mode === 'point2'
              ? 'border-[#f59e0b]/50 bg-[#f59e0b]/5'
              : ''
          }`}>
            {mode === 'idle' && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">📏</span>
                <div>
                  <p className="font-medium text-white">Kalibrácia mierky</p>
                  <p className="text-slate-400">Klikni &quot;Začať meranie&quot; a označ 2 body na fotke, ktorých reálnu vzdialenosť poznáš.</p>
                </div>
              </div>
            )}
            {mode === 'point1' && (
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-pulse-orange">👆</span>
                <div>
                  <p className="font-medium text-[#f59e0b]">Klikni na PRVÝ bod</p>
                  <p className="text-slate-400">Napr. ľavý okraj dverí, okna alebo iného prvku s známym rozmerom.</p>
                </div>
              </div>
            )}
            {mode === 'point2' && (
              <div className="flex items-center gap-3">
                <span className="text-2xl animate-pulse-orange">👆</span>
                <div>
                  <p className="font-medium text-[#f59e0b]">Klikni na DRUHÝ bod</p>
                  <p className="text-slate-400">Druhý koniec toho istého prvku (napr. pravý okraj dverí).</p>
                </div>
              </div>
            )}
            {mode === 'done' && factor && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">✅</span>
                <div>
                  <p className="font-medium text-green-400">Mierka nastavená</p>
                  <p className="text-slate-400">
                    {pixelDist.toFixed(0)} px = {realCm} cm → <span className="text-white font-medium">{factor.toFixed(3)} mm/px</span>
                  </p>
                </div>
              </div>
            )}
            {mode === 'done' && !factor && (
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-medium text-yellow-400">Body označené – zadaj reálny rozmer</p>
                  <p className="text-slate-400">Vzdialenosť na fotke: {pixelDist.toFixed(0)} px</p>
                </div>
              </div>
            )}
          </div>

          {/* Fotka s bodmi */}
          <div className="relative rounded-2xl overflow-hidden border border-[#2a2a2a] bg-black">
            {photo.url && (
              <>
                <img
                  ref={imgRef}
                  src={photo.url}
                  alt="Fasáda – meranie"
                  className={`w-full max-h-[500px] object-contain ${
                    mode === 'point1' || mode === 'point2'
                      ? 'cursor-crosshair'
                      : ''
                  }`}
                  onClick={handleImageClick}
                  draggable={false}
                />

                {/* Overlay SVG pre body a čiaru */}
                {(tempPoint1 || tempPoint2) && imgRef.current && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${imgRef.current.clientWidth} ${imgRef.current.clientHeight}`}
                    preserveAspectRatio="none"
                  >
                    {/* Čiara medzi bodmi */}
                    {tempPoint1 && tempPoint2 && (
                      <line
                        x1={tempPoint1.x / (photo.width / (imgRef.current?.clientWidth || 1))}
                        y1={tempPoint1.y / (photo.height / (imgRef.current?.clientHeight || 1))}
                        x2={tempPoint2.x / (photo.width / (imgRef.current?.clientWidth || 1))}
                        y2={tempPoint2.y / (photo.height / (imgRef.current?.clientHeight || 1))}
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeDasharray="6 4"
                      />
                    )}
                    {/* Bod 1 */}
                    {tempPoint1 && (
                      <circle
                        cx={tempPoint1.x / (photo.width / (imgRef.current?.clientWidth || 1))}
                        cy={tempPoint1.y / (photo.height / (imgRef.current?.clientHeight || 1))}
                        r="8"
                        fill="#f59e0b"
                        stroke="white"
                        strokeWidth="2"
                      />
                    )}
                    {/* Bod 2 */}
                    {tempPoint2 && (
                      <circle
                        cx={tempPoint2.x / (photo.width / (imgRef.current?.clientWidth || 1))}
                        cy={tempPoint2.y / (photo.height / (imgRef.current?.clientHeight || 1))}
                        r="8"
                        fill="#f59e0b"
                        stroke="white"
                        strokeWidth="2"
                      />
                    )}
                    {/* Label na čiare */}
                    {tempPoint1 && tempPoint2 && realCm && (
                      <text
                        x={(tempPoint1.x / (photo.width / (imgRef.current?.clientWidth || 1)) +
                          tempPoint2.x / (photo.width / (imgRef.current?.clientWidth || 1))) / 2}
                        y={(tempPoint1.y / (photo.height / (imgRef.current?.clientHeight || 1)) +
                          tempPoint2.y / (photo.height / (imgRef.current?.clientHeight || 1))) / 2 - 12}
                        textAnchor="middle"
                        fill="white"
                        fontSize="14"
                        fontWeight="bold"
                        style={{ textShadow: '0 0 6px rgba(0,0,0,0.8)' }}
                      >
                        {realCm} cm
                      </text>
                    )}
                  </svg>
                )}
              </>
            )}
          </div>

          {/* Tlačidlá merania */}
          <div className="flex gap-3">
            {mode === 'idle' && (
              <button
                onClick={() => setMode('point1')}
                className="px-5 py-2.5 rounded-xl btn-orange text-sm"
              >
                📏 Začať meranie
              </button>
            )}
            {(mode === 'done' || mode === 'point1' || mode === 'point2') && (
              <button
                onClick={handleReset}
                className="px-5 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm transition-colors"
              >
                ↻ Nové meranie
              </button>
            )}
          </div>
        </div>

        {/* === Pravá strana: Nastavenia === */}
        <div className="space-y-5">
          {/* Referenčný rozmer */}
          <div className="glass rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-slate-300">Referenčný rozmer</h3>

            {/* Predvoľby */}
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setRefLabel(preset.label);
                    setRealCm(String(preset.cm));
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    refLabel === preset.label && realCm === String(preset.cm)
                      ? 'bg-[#f59e0b] text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {preset.label} ({preset.cm} cm)
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Reálna vzdialenosť medzi bodmi (cm):
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={realCm}
                  onChange={(e) => setRealCm(e.target.value)}
                  placeholder="napr. 90"
                  min={1}
                  max={10000}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-lg font-bold placeholder-slate-600 focus:border-[#f59e0b] outline-none"
                />
                <span className="flex items-center text-slate-400 font-medium">cm</span>
              </div>
            </div>

            {/* Výsledok */}
            {factor && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
                <p className="text-green-400 font-medium">Mierka: {factor.toFixed(3)} mm/px</p>
                <p className="text-slate-400 text-xs mt-1">
                  1 pixel na fotke = {factor.toFixed(2)} mm v skutočnosti
                </p>
              </div>
            )}
          </div>

          {/* Výška písmen / loga */}
          <div className="glass rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-slate-300">
              {contentType === 'logo_only' ? 'Výška loga' : 'Výška písmen'}
            </h3>

            {/* Predvoľby */}
            <div className="grid grid-cols-2 gap-2">
              {heightPresets.map((preset) => (
                <button
                  key={preset.mm}
                  onClick={() => setLetterHeightInput(String(preset.mm))}
                  className={`p-2.5 rounded-lg text-left transition-colors ${
                    letterHeightMm === preset.mm
                      ? 'bg-[#f59e0b]/10 border border-[#f59e0b]'
                      : 'bg-slate-800/50 border border-[#2a2a2a] hover:border-slate-600'
                  }`}
                >
                  <div className="text-sm font-medium text-white">{preset.label}</div>
                  <div className="text-xs text-slate-500">{preset.desc}</div>
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Vlastná výška (mm):
              </label>
              <input
                type="number"
                value={letterHeightInput}
                onChange={(e) => setLetterHeightInput(e.target.value)}
                placeholder="200"
                min={30}
                max={2000}
                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-lg font-bold placeholder-slate-600 focus:border-[#f59e0b] outline-none"
              />
            </div>

            {/* Varovania */}
            {letterHeightMm < 50 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs text-yellow-400">
                ⚠️ Písmená pod 50 mm sú vhodné len pre interiér. Pre exteriér odporúčame min. 100 mm.
              </div>
            )}
            {letterHeightMm > 400 && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-400">
                ℹ️ Písmená nad 400 mm budú automaticky rozdelené na segmenty pre tlač.
              </div>
            )}
          </div>

          {/* Rýchle zhrnutie */}
          <div className="glass rounded-xl p-5">
            <h3 className="text-sm font-medium text-slate-300 mb-3">Zhrnutie rozmerov</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">
                  {contentType === 'logo_only' ? 'Výška loga:' : 'Výška písmen:'}
                </span>
                <span className="text-white font-bold">{letterHeightMm} mm</span>
              </div>
              {factor && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Mierka:</span>
                  <span className="text-white">{factor.toFixed(2)} mm/px</span>
                </div>
              )}
              {contentType !== 'logo_only' && text && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Počet písmen:</span>
                  <span className="text-white">{text.replace(/\s/g, '').length}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Odhadovaná šírka:</span>
                <span className="text-white">
                  ~{(() => {
                    if (contentType === 'logo_only' && logo.originalWidth && logo.originalHeight) {
                      // Logo: šírka = výška × pomer strán loga (celý objekt)
                      return Math.round(letterHeightMm * (logo.originalWidth / logo.originalHeight));
                    }
                    // Text: šírka = výška × 0.65 × počet písmen
                    const letterCount = text.replace(/\s/g, '').length || 1;
                    return Math.round(letterHeightMm * 0.65 * letterCount);
                  })()} mm
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upozornenie ak chýba rozmer */}
      {!factor && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-medium text-yellow-400">Nebol zadaný referenčný rozmer</p>
            <p className="text-slate-400 text-xs mt-1">
              Bez merania sa použije predvolená výška {letterHeightMm} mm. Pre presné rozmery
              označ 2 body na fotke a zadaj reálnu vzdialenosť.
            </p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button onClick={prevStep} className="px-6 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
          ← Späť
        </button>
        <button onClick={nextStep} className="px-8 py-3 rounded-xl btn-orange">
          Pokračovať →
        </button>
      </div>
    </div>
  );
}

// ==================================================================
// PREVIEW STEP – 3D scéna + konfiguračný sidebar
// ==================================================================

function PreviewStepPlaceholder() {
  const text = useConfiguratorStore((s) => s.text);
  const profileType = useConfiguratorStore((s) => s.profileType);
  const depthMm = useConfiguratorStore((s) => s.depthMm);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const sideColor = useConfiguratorStore((s) => s.sideColor);
  const fontFamily = useConfiguratorStore((s) => s.fontFamily);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const computed = useConfiguratorStore((s) => s.computed);
  const nextStep = useConfiguratorStore((s) => s.nextStep);
  const prevStep = useConfiguratorStore((s) => s.prevStep);
  const photoUrl = useConfiguratorStore((s) => s.photo.url);

  const [viewTab, setViewTab] = useState<'3d_facade' | 'flat_facade' | '3d_only' | 'manufacturing'>('3d_facade');

  const hasLogo = !!(logo.svgUrl || logo.rasterUrl);

  const lightingLabels: Record<string, string> = {
    none: 'Žiadny',
    channel: 'Kanálové písmeno',
    channel_front: 'Kanálové s LED',
    front: 'Predný (front-lit)',
    halo: 'Halo (zadný)',
    front_halo: 'Predný + Halo',
  };
  const profileLabels: Record<string, string> = {
    flat: 'Rovný',
    rounded: 'Zaoblený',
    chamfer: 'Skosený',
  };

  return (
    <div className="max-w-7xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Náhľad</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main viewport area */}
        <div className="lg:col-span-2">
          {/* ── Tab switcher ── */}
          <div className="flex gap-1 mb-3 glass rounded-xl p-1 w-fit">
            <button
              onClick={() => setViewTab('3d_facade')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewTab === '3d_facade'
                  ? 'bg-[#f59e0b] text-[#0a0a0a] shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              🏗️ 3D na fasáde
            </button>
            <button
              onClick={() => setViewTab('flat_facade')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewTab === 'flat_facade'
                  ? 'bg-[#f59e0b] text-[#0a0a0a] shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              🏠 2D pohľad
            </button>
            <button
              onClick={() => setViewTab('3d_only')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewTab === '3d_only'
                  ? 'bg-[#f59e0b] text-[#0a0a0a] shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              🧊 3D detail
            </button>
            <button
              onClick={() => setViewTab('manufacturing')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewTab === 'manufacturing'
                  ? 'bg-emerald-500 text-[#0a0a0a] shadow-lg'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              🏭 Výrobné diely
            </button>
          </div>

          {/* 
            DÔLEŽITÉ: Vždy renderujeme IBA aktívny tab.
            Každý Canvas má unikátny key, čím sa pri prepnutí
            kompletne unmountne a uvoľní WebGL kontext.
          */}

          {/* ── 3D na fasáde (hlavný) – fotka budovy + 3D písmená, orbit kamery ── */}
          {viewTab === '3d_facade' && (
            <div key="view-3d-facade">
              <div className="canvas-container glass rounded-2xl overflow-hidden" style={{ minHeight: 500 }}>
                <Scene3D />
              </div>
              <div className="flex items-center justify-between mt-3 px-1">
                <p className="text-xs text-slate-500">
                  🖱️ Ťahaj myšou pre otáčanie okolo budovy · Koliesko = zoom · Shift+ťahaj = posun
                </p>
              </div>
            </div>
          )}

          {/* ── 2D pohľad na fasádu (drag & drop text) ── */}
          {viewTab === 'flat_facade' && (
            <div key="view-flat-facade">
              {photoUrl ? (
                <FacadePreview />
              ) : (
                <div className="w-full flex items-center justify-center min-h-[400px] glass rounded-2xl">
                  <div className="text-center">
                    <div className="text-5xl mb-4">📷</div>
                    <p className="text-slate-400 mb-1">Žiadna fotka fasády</p>
                    <p className="text-slate-500 text-sm">
                      Vráťte sa na krok 1 a nahrajte fotku
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-3 px-1">
                <p className="text-xs text-slate-500">
                  ✋ Klikni a ťahaj nápis pre presun na fasáde
                </p>
              </div>
            </div>
          )}

          {/* ── 3D detail (izolované 3D písmená bez fasády) ── */}
          {viewTab === '3d_only' && (
            <div key="view-3d-only">
              <div className="canvas-container glass rounded-2xl overflow-hidden" style={{ minHeight: 500 }}>
                <Scene3DDetail />
              </div>
              <div className="flex items-center justify-between mt-3 px-1">
                <p className="text-xs text-slate-500">
                  🖱️ Voľné otáčanie · Koliesko = zoom
                </p>
              </div>
            </div>
          )}

          {/* ── Výrobné diely – 3D STL vizualizácia ── */}
          {viewTab === 'manufacturing' && (
            <div key="view-manufacturing" className="glass rounded-2xl p-6">
              <STLDownload fullView />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Configuration summary */}
          <div className="glass rounded-xl p-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Konfigurácia</h3>
            <div className="space-y-2 text-sm">
              <SummaryRow
                label="Typ"
                value={
                  contentType === 'text_only'
                    ? 'Text'
                    : contentType === 'logo_only'
                    ? 'Logo'
                    : 'Text + Logo'
                }
              />
              {text && <SummaryRow label="Text" value={text} />}
              {text && <SummaryRow label="Font" value={fontFamily} />}
              {hasLogo && (
                <SummaryRow
                  label="Logo"
                  value={logo.sourceType === 'svg' ? '3D (SVG)' : 'Reliéf'}
                />
              )}
              <SummaryRow label="Profil" value={profileLabels[profileType] || profileType} />
              <SummaryRow label="Hĺbka" value={`${depthMm} mm`} />
              <SummaryRow label="Výška" value={`${computed.letterHeightMm || 200} mm`} />
              <SummaryRow label="Podsvit" value={lightingLabels[lightingType] || lightingType} />
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Farby</span>
                <div className="flex gap-1.5">
                  <div
                    className="w-5 h-5 rounded border border-slate-600"
                    style={{ backgroundColor: faceColor }}
                    title="Čelo"
                  />
                  <div
                    className="w-5 h-5 rounded border border-slate-600"
                    style={{ backgroundColor: sideColor }}
                    title="Bočnica"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Price */}
          <PriceDisplay compact />

          {/* STL Download */}
          <STLDownload />

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={nextStep}
              className="w-full px-6 py-3 rounded-xl btn-orange text-lg font-semibold"
            >
              Objednať →
            </button>
            <button
              onClick={prevStep}
              className="w-full px-6 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm transition-colors"
            >
              ← Upraviť nastavenia
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-white font-medium truncate ml-3 max-w-[160px] text-right">{value}</span>
    </div>
  );
}

// ==================================================================
// ORDER STEP – kompletný formulár + cenový prehľad + odoslanie
// ==================================================================

function OrderStepPlaceholder() {
  const order = useConfiguratorStore((s) => s.order);
  const setOrder = useConfiguratorStore((s) => s.setOrder);
  const text = useConfiguratorStore((s) => s.text);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);
  const prevStep = useConfiguratorStore((s) => s.prevStep);

  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState('');

  const letterCount = text.replace(/\s/g, '').length;
  const hasLogo = !!(logo.svgUrl || logo.rasterUrl);

  // Validácia
  const canSubmit =
    order.clientName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.clientEmail) &&
    order.clientPhone.trim().length >= 6 &&
    agreed;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    // Simulácia odoslania (bez API)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const id =
      'ORD-' +
      Date.now().toString(36).toUpperCase() +
      '-' +
      Math.random().toString(36).substring(2, 6).toUpperCase();
    setOrderId(id);

    // Uložiť do localStorage
    try {
      const orders = JSON.parse(localStorage.getItem('adsun_orders') || '[]');
      orders.push({
        id,
        date: new Date().toISOString(),
        order,
        text,
        contentType,
        hasLogo,
      });
      localStorage.setItem('adsun_orders', JSON.stringify(orders));
    } catch {
      // ignore
    }

    setSubmitting(false);
    setSubmitted(true);
  };

  // ── Success screen ──
  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="text-6xl mb-6 animate-fade-in-up">✅</div>
        <h2 className="text-3xl font-bold text-white mb-4 animate-fade-in-up">
          Ďakujeme za objednávku!
        </h2>
        <p className="text-lg text-slate-400 mb-2">
          Vaša objednávka bola úspešne odoslaná.
        </p>
        <div className="glass rounded-xl p-6 inline-block mt-6 mb-8">
          <p className="text-sm text-slate-500">Číslo objednávky</p>
          <p className="text-2xl font-bold text-[#f59e0b] font-mono mt-1">{orderId}</p>
        </div>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Na email <span className="text-white font-medium">{order.clientEmail}</span> odošleme
          potvrdenie. Ozveme sa vám do 24 hodín s ďalšími krokmi.
        </p>
        <button
          onClick={() => {
            useConfiguratorStore.getState().reset();
            setSubmitted(false);
          }}
          className="px-8 py-3 rounded-xl btn-orange"
        >
          Nová konfigurácia
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Objednávka</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulár */}
        <div className="lg:col-span-2 space-y-6">
          {/* Kontaktné údaje */}
          <div className="glass rounded-xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Kontaktné údaje</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Meno a priezvisko *
                </label>
                <input
                  type="text"
                  placeholder="Ján Novák"
                  value={order.clientName}
                  onChange={(e) => setOrder({ clientName: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-600 focus:border-[#f59e0b] outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Telefón *</label>
                <input
                  type="tel"
                  placeholder="+421 9XX XXX XXX"
                  value={order.clientPhone}
                  onChange={(e) => setOrder({ clientPhone: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-600 focus:border-[#f59e0b] outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Email *</label>
              <input
                type="email"
                placeholder="email@example.com"
                value={order.clientEmail}
                onChange={(e) => setOrder({ clientEmail: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-600 focus:border-[#f59e0b] outline-none"
              />
            </div>
          </div>

          {/* Typ objednávky */}
          <div className="glass rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Typ objednávky</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setOrder({ type: 'production_only' })}
                className={`p-4 rounded-xl border-2 text-center transition-all ${
                  order.type === 'production_only'
                    ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                    : 'border-[#2a2a2a] hover:border-slate-600'
                }`}
              >
                <div className="text-2xl mb-2">📦</div>
                <div className="text-sm font-medium text-white">Len výroba</div>
                <div className="text-xs text-slate-500">Doručenie na adresu</div>
              </button>
              <button
                onClick={() => setOrder({ type: 'production_and_installation' })}
                className={`p-4 rounded-xl border-2 text-center transition-all ${
                  order.type === 'production_and_installation'
                    ? 'border-[#f59e0b] bg-[#f59e0b]/5'
                    : 'border-[#2a2a2a] hover:border-slate-600'
                }`}
              >
                <div className="text-2xl mb-2">🔧</div>
                <div className="text-sm font-medium text-white">Výroba + montáž</div>
                <div className="text-xs text-slate-500">Kompletná realizácia</div>
              </button>
            </div>
          </div>

          {/* Adresa montáže */}
          {order.type === 'production_and_installation' && (
            <div className="glass rounded-xl p-6">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Adresa montáže
              </label>
              <input
                type="text"
                placeholder="Ulica a číslo, Mesto, PSČ"
                value={order.installationAddress}
                onChange={(e) => setOrder({ installationAddress: e.target.value })}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-600 focus:border-[#f59e0b] outline-none"
              />
            </div>
          )}

          {/* Poznámka */}
          <div className="glass rounded-xl p-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Poznámka (voliteľné)
            </label>
            <textarea
              placeholder="Špeciálne požiadavky, termín dodania, iné..."
              value={order.notes}
              onChange={(e) => setOrder({ notes: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700 text-white placeholder-slate-600 focus:border-[#f59e0b] outline-none resize-none"
            />
          </div>

          {/* Súhlas + odoslanie */}
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 w-5 h-5 rounded accent-[#f59e0b] shrink-0"
              />
              <span className="text-sm text-slate-400">
                Súhlasím s obchodnými podmienkami a spracovaním osobných údajov.
                Rozumiem, že finálna cena bude potvrdená po kontrole konfigurácie.
              </span>
            </label>

            <div className="flex justify-between pt-2">
              <button
                onClick={prevStep}
                className="px-6 py-3 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                ← Späť
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="px-8 py-3 rounded-xl btn-orange disabled:opacity-50 flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="animate-spin inline-block">⏳</span>
                    Odosielam...
                  </>
                ) : (
                  '🚀 Odoslať objednávku'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar – cenový prehľad */}
        <div className="space-y-4">
          <PriceDisplay />

          {/* Quick summary */}
          <div className="glass rounded-xl p-4">
            <h3 className="text-sm font-medium text-slate-400 mb-3">Zhrnutie</h3>
            <div className="space-y-2 text-sm">
              {text && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Text</span>
                  <span className="text-white font-medium truncate ml-2 max-w-[120px]">
                    {text}
                  </span>
                </div>
              )}
              {letterCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Písmená</span>
                  <span className="text-white">{letterCount}</span>
                </div>
              )}
              {hasLogo && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Logo</span>
                  <span className="text-white">
                    {logo.sourceType === 'svg' ? 'SVG (3D)' : 'Raster'}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Typ</span>
                <span className="text-white">
                  {order.type === 'production_only' ? 'Len výroba' : 'Výroba + montáž'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// === Helpers ===

function canNavigateToStep(
  target: ConfiguratorStep,
  current: ConfiguratorStep,
  hasPhoto: boolean,
): boolean {
  const targetIdx = STEP_ORDER.indexOf(target);
  const currentIdx = STEP_ORDER.indexOf(current);

  // Vždy sa dá vrátiť späť
  if (targetIdx <= currentIdx) return true;

  // Vpred: musí mať aspoň fotku
  if (targetIdx >= 1 && !hasPhoto) return false;

  // Maximálne 1 krok dopredu
  return targetIdx <= currentIdx + 1;
}
