'use client';

/**
 * Color Picker – RAL farby s vizuálnymi swatchmi
 *
 * Podporuje:
 * - Štandardné RAL farby pre signmaking
 * - Metalické farby (+20% prirážka)
 * - Prepínanie medzi farbou čela a bočníc
 * - Vlastný HEX vstup
 */

import { useState } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';

// ──────────────────────────────────────────────
// RAL farby bežné pre svetelné reklamy
// ──────────────────────────────────────────────

const RAL_COLORS = [
  // Základné
  { ral: 'RAL 9003', name: 'Signálová biela', hex: '#F4F4F4', category: 'standard' as const },
  { ral: 'RAL 9005', name: 'Hlboká čierna', hex: '#0A0A0A', category: 'standard' as const },
  { ral: 'RAL 7016', name: 'Antracitová šedá', hex: '#383E42', category: 'standard' as const },
  { ral: 'RAL 7035', name: 'Svetlá šedá', hex: '#D7D7D7', category: 'standard' as const },
  // Červené
  { ral: 'RAL 3020', name: 'Dopravná červená', hex: '#CC0605', category: 'standard' as const },
  { ral: 'RAL 3003', name: 'Rubínová červená', hex: '#8D1D2C', category: 'standard' as const },
  // Modré
  { ral: 'RAL 5015', name: 'Nebeská modrá', hex: '#007CB0', category: 'standard' as const },
  { ral: 'RAL 5002', name: 'Ultramarín modrá', hex: '#20214F', category: 'standard' as const },
  { ral: 'RAL 5005', name: 'Signálová modrá', hex: '#1E3A5F', category: 'standard' as const },
  // Žlté / Oranžové
  { ral: 'RAL 1023', name: 'Dopravná žltá', hex: '#F0CA00', category: 'standard' as const },
  { ral: 'RAL 2004', name: 'Čistá oranžová', hex: '#E75B12', category: 'standard' as const },
  // Zelené
  { ral: 'RAL 6018', name: 'Žltozelená', hex: '#57A639', category: 'standard' as const },
  { ral: 'RAL 6029', name: 'Mätová zelená', hex: '#20603D', category: 'standard' as const },
  // Ostatné
  { ral: 'RAL 4006', name: 'Dopravná purpurová', hex: '#A5195B', category: 'standard' as const },
  { ral: 'RAL 8001', name: 'Okerová hnedá', hex: '#955F20', category: 'standard' as const },
  // Metalické
  { ral: 'GOLD', name: 'Zlatá metalíza', hex: '#CFB53B', category: 'metallic' as const },
  { ral: 'SILVER', name: 'Strieborná metalíza', hex: '#C0C0C0', category: 'metallic' as const },
  { ral: 'ROSE_GOLD', name: 'Rose gold', hex: '#B76E79', category: 'metallic' as const },
  { ral: 'COPPER', name: 'Medená metalíza', hex: '#B87333', category: 'metallic' as const },
  { ral: 'CHROME', name: 'Chróm efekt', hex: '#DBE4EB', category: 'metallic' as const },
];

type ColorTarget = 'face' | 'side';

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function ColorPicker() {
  const faceColor = useConfiguratorStore((s) => s.faceColor);
  const sideColor = useConfiguratorStore((s) => s.sideColor);
  const faceRal = useConfiguratorStore((s) => s.faceRal);
  const sideRal = useConfiguratorStore((s) => s.sideRal);
  const setFaceColor = useConfiguratorStore((s) => s.setFaceColor);
  const setSideColor = useConfiguratorStore((s) => s.setSideColor);

  const [target, setTarget] = useState<ColorTarget>('face');
  const [customHex, setCustomHex] = useState('');

  const currentColor = target === 'face' ? faceColor : sideColor;
  const currentRal = target === 'face' ? faceRal : sideRal;
  const setColor = target === 'face' ? setFaceColor : setSideColor;

  const handleColorSelect = (hex: string, ral: string) => {
    setColor(hex, ral);
  };

  const handleCustomHex = () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(customHex)) {
      setColor(customHex, 'Vlastná');
      setCustomHex('');
    }
  };

  const standardColors = RAL_COLORS.filter((c) => c.category === 'standard');
  const metallicColors = RAL_COLORS.filter((c) => c.category === 'metallic');

  return (
    <div className="glass rounded-xl p-6 space-y-4">
      <label className="block text-sm font-medium text-slate-300">Farby</label>

      {/* Face / Side toggle */}
      <div className="flex gap-2">
        {([
          { key: 'face' as ColorTarget, label: 'Čelo', color: faceColor },
          { key: 'side' as ColorTarget, label: 'Bočnice', color: sideColor },
        ]).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setTarget(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              target === key
                ? 'bg-[#f59e0b]/10 border border-[#f59e0b] text-white'
                : 'bg-slate-800/50 border border-[#2a2a2a] text-slate-400'
            }`}
          >
            <div
              className="w-4 h-4 rounded-sm border border-slate-600 shrink-0"
              style={{ backgroundColor: color }}
            />
            {label}
          </button>
        ))}
      </div>

      {/* Standard colors */}
      <div>
        <p className="text-xs text-slate-500 mb-2">Štandard</p>
        <div className="grid grid-cols-5 gap-2">
          {standardColors.map((color) => (
            <button
              key={color.ral}
              onClick={() => handleColorSelect(color.hex, color.ral)}
              className={`color-swatch ${currentRal === color.ral ? 'selected' : ''}`}
              style={{ backgroundColor: color.hex }}
              title={`${color.ral} – ${color.name}`}
            />
          ))}
        </div>
      </div>

      {/* Metallic colors */}
      <div>
        <p className="text-xs text-slate-500 mb-2">
          Metalické <span className="text-[#f59e0b]">(+20%)</span>
        </p>
        <div className="grid grid-cols-5 gap-2">
          {metallicColors.map((color) => (
            <button
              key={color.ral}
              onClick={() => handleColorSelect(color.hex, color.ral)}
              className={`color-swatch ${currentRal === color.ral ? 'selected' : ''}`}
              style={{ backgroundColor: color.hex }}
              title={color.name}
            />
          ))}
        </div>
      </div>

      {/* Current color info */}
      <div className="flex items-center gap-3 bg-slate-800/30 rounded-lg p-3">
        <div
          className="w-9 h-9 rounded-lg border border-slate-600 shrink-0"
          style={{ backgroundColor: currentColor }}
        />
        <div className="min-w-0">
          <p className="text-sm text-white font-medium truncate">
            {currentRal || 'Vlastná farba'}
          </p>
          <p className="text-xs text-slate-500">{currentColor}</p>
        </div>
      </div>

      {/* Custom HEX input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={customHex}
          onChange={(e) => setCustomHex(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCustomHex()}
          placeholder="#FF5500"
          maxLength={7}
          className="flex-1 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm placeholder-slate-600 focus:border-[#f59e0b] outline-none"
        />
        <input
          type="color"
          value={customHex || currentColor}
          onChange={(e) => {
            setCustomHex(e.target.value);
            setColor(e.target.value, 'Vlastná');
          }}
          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0"
          title="Vybrať farbu"
        />
        <button
          onClick={handleCustomHex}
          disabled={!/^#[0-9A-Fa-f]{6}$/.test(customHex)}
          className="px-3 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 disabled:opacity-40 transition-colors"
        >
          OK
        </button>
      </div>

      {/* Same color shortcut */}
      {faceColor !== sideColor && (
        <button
          onClick={() => {
            if (target === 'face') {
              setSideColor(faceColor, faceRal);
            } else {
              setFaceColor(sideColor, sideRal);
            }
          }}
          className="w-full text-xs text-slate-500 hover:text-[#f59e0b] transition-colors py-1"
        >
          Použiť rovnakú farbu na čelo aj bočnice
        </button>
      )}
    </div>
  );
}
