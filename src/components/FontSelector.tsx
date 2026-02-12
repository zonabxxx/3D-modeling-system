'use client';

/**
 * Font Selector – mriežka 10 fontov s vizuálnym náhľadom
 *
 * Fonty sa načítavajú z Google Fonts CDN a zobrazujú sa
 * s aktuálnym textom užívateľa.
 */

import { useEffect, useState } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';

// ──────────────────────────────────────────────
// Font definitions
// ──────────────────────────────────────────────

const FONTS = [
  { id: 'montserrat', name: 'Montserrat Bold', family: 'Montserrat', weight: '700', file: 'Montserrat-Bold.ttf' },
  { id: 'bebas', name: 'Bebas Neue', family: 'Bebas Neue', weight: '400', file: 'BebasNeue-Regular.ttf' },
  { id: 'oswald', name: 'Oswald Bold', family: 'Oswald', weight: '700', file: 'Oswald-Bold.ttf' },
  { id: 'poppins', name: 'Poppins Black', family: 'Poppins', weight: '900', file: 'Poppins-Black.ttf' },
  { id: 'roboto', name: 'Roboto Bold', family: 'Roboto', weight: '700', file: 'Roboto-Bold.ttf' },
  { id: 'inter', name: 'Inter Bold', family: 'Inter', weight: '700', file: 'Inter-Bold.ttf' },
  { id: 'raleway', name: 'Raleway Black', family: 'Raleway', weight: '900', file: 'Raleway-Black.ttf' },
  { id: 'archivo', name: 'Archivo Black', family: 'Archivo Black', weight: '400', file: 'ArchivoBlack-Regular.ttf' },
  { id: 'outfit', name: 'Outfit Bold', family: 'Outfit', weight: '700', file: 'Outfit-Bold.ttf' },
  { id: 'barlow', name: 'Barlow Bold', family: 'Barlow', weight: '700', file: 'Barlow-Bold.ttf' },
] as const;

// Build Google Fonts CSS URL
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=' +
  FONTS.map((f) =>
    `${f.family.replace(/ /g, '+')}:wght@${f.weight}`,
  ).join('&family=') +
  '&display=swap';

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function FontSelector() {
  const text = useConfiguratorStore((s) => s.text) || 'ADSUN';
  const fontFamily = useConfiguratorStore((s) => s.fontFamily);
  const setFont = useConfiguratorStore((s) => s.setFont);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Dynamicky pridaj <link> pre Google Fonts
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const existingLink = document.getElementById('gf-configurator');
    if (existingLink) {
      setFontsLoaded(true);
      return;
    }

    const link = document.createElement('link');
    link.id = 'gf-configurator';
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;
    link.onload = () => setFontsLoaded(true);
    document.head.appendChild(link);
  }, []);

  // Skrátený text pre preview (max 12 znakov)
  const preview = text.length > 0 ? text.substring(0, 12) : 'ADSUN';

  return (
    <div className="glass rounded-xl p-6">
      <label className="block text-sm font-medium text-slate-300 mb-4">
        Font písma
      </label>

      <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
        {FONTS.map((font) => {
          const isSelected = fontFamily === font.family;
          return (
            <button
              key={font.id}
              onClick={() => setFont(font.family, `/fonts/${font.file}`, font.id)}
              className={`font-card text-left transition-all ${isSelected ? 'selected' : ''}`}
            >
              <div
                className="text-lg text-white mb-1 truncate leading-tight"
                style={{
                  fontFamily: fontsLoaded ? `'${font.family}', sans-serif` : 'sans-serif',
                  fontWeight: Number(font.weight),
                }}
              >
                {preview}
              </div>
              <div className="text-xs text-slate-500">{font.name}</div>
            </button>
          );
        })}
      </div>

      {!fontsLoaded && (
        <p className="text-xs text-slate-600 mt-3 text-center animate-pulse">
          Načítavam fonty...
        </p>
      )}
    </div>
  );
}
