'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ManufacturingPreset {
  id: string;
  name: string;
  description: string | null;
  lightingType: string;
  isDefault: boolean | null;

  wallThickness: number;
  wallHeight: number | null;
  wallOffset: number | null;

  externalWallRecess: number | null;
  internalWallRecess: number | null;

  faceThickness: number;
  faceIsSeparate: boolean | null;
  faceIsTranslucent: boolean | null;
  faceInset: number | null;

  acrylicThickness: number | null;
  acrylicClearance: number | null;

  backPanelThickness: number;
  backIsOpen: boolean | null;
  backStandoff: number | null;

  bottomThickness: number | null;
  baseThickness: number | null;

  ledModule: string | null;
  ledCavityDepth: number | null;
  ledCavityOffset: number | null;
  ledBaseThickness: number | null;

  innerLining: number | null;
  internalWalls: boolean | null;
  ribSpacing: number | null;
  minRibSize: number | null;
  ribThickness: number | null;

  mountingHoleDiameter: number | null;
  mountingHoleSpacing: number | null;
  mountingTabSize: number | null;
  standoffLength: number | null;

  ventHoleDiameter: number | null;
  ventHoleSpacing: number | null;

  maxSinglePiece: number | null;
  connectorType: string | null;
  connectorDepth: number | null;
  connectorTolerance: number | null;

  geometryPrecision: number | null;
  sortOrder: number | null;
  isActive: boolean;
}

type PresetField = keyof ManufacturingPreset;

// ─────────────────────────────────────────────
// Parameter definitions for UI
// ─────────────────────────────────────────────

interface ParamDef {
  key: PresetField;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  type: 'number' | 'boolean' | 'text' | 'select';
  options?: { value: string; label: string }[];
  tooltip?: string;
}

interface ParamGroup {
  title: string;
  icon: string;
  description: string;
  params: ParamDef[];
}

const PARAM_GROUPS: ParamGroup[] = [
  {
    title: 'Steny (Wall)',
    icon: '🧱',
    description: 'Hrúbka a rozmery bočných stien korpusu písmena',
    params: [
      { key: 'wallThickness', label: 'Hrúbka steny', unit: 'mm', min: 0.5, max: 10, step: 0.1, type: 'number', tooltip: 'Hrúbka bočných stien korpusu' },
      { key: 'wallHeight', label: 'Výška steny', unit: 'mm', min: 0, max: 200, step: 0.5, type: 'number', tooltip: '0 = plná hĺbka písmena' },
      { key: 'wallOffset', label: 'Odsadenie steny', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number', tooltip: 'Odsadenie od vonkajšieho obrysu' },
    ],
  },
  {
    title: 'Drážky pre plexi (Recess)',
    icon: '📐',
    description: 'Drážky na stenách pre zasunutie predného akrylátového čela',
    params: [
      { key: 'externalWallRecess', label: 'Vonkajšia drážka', unit: 'mm', min: 0, max: 50, step: 0.1, type: 'number', tooltip: 'Drážka na vonkajšej stene pre zasadenie plexi. Kľúčový parameter!' },
      { key: 'internalWallRecess', label: 'Vnútorná drážka', unit: 'mm', min: 0, max: 50, step: 0.5, type: 'number', tooltip: 'Zníženie vnútornej steny – vytvára priestor za plexi pre LED' },
    ],
  },
  {
    title: 'Čelo / Akrylát (Face)',
    icon: '🔲',
    description: 'Nastavenia predného čela a akrylátového panelu',
    params: [
      { key: 'faceThickness', label: 'Hrúbka čela', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number', tooltip: 'Hrúbka predného čela korpusu' },
      { key: 'faceIsSeparate', label: 'Čelo je samostatný diel', type: 'boolean', tooltip: 'Ak áno, čelo sa generuje ako oddelený STL' },
      { key: 'faceIsTranslucent', label: 'Čelo je priesvitné', type: 'boolean', tooltip: 'Opálové/priesvitné čelo pre LED podsvietenie' },
      { key: 'faceInset', label: 'Zapustenie čela', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number', tooltip: 'O koľko mm je čelo zapustené do korpusu' },
      { key: 'acrylicThickness', label: 'Hrúbka akrylátu', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number', tooltip: 'Hrúbka akrylátového (plexi) čela' },
      { key: 'acrylicClearance', label: 'Vôľa akrylátu', unit: 'mm', min: 0, max: 1, step: 0.05, type: 'number', tooltip: 'Presná vôľa medzi akrylátom a korpusom. Krok 0.05mm!' },
    ],
  },
  {
    title: 'Zadný panel (Back)',
    icon: '🔳',
    description: 'Nastavenia zadnej strany písmena',
    params: [
      { key: 'backPanelThickness', label: 'Hrúbka zadného panelu', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number' },
      { key: 'backIsOpen', label: 'Zadok otvorený', type: 'boolean', tooltip: 'Pre halo efekt – zadná strana je otvorená' },
      { key: 'backStandoff', label: 'Dištanc od steny', unit: 'mm', min: 0, max: 100, step: 1, type: 'number', tooltip: 'Vzdialenosť písmena od fasády (pre halo efekt)' },
    ],
  },
  {
    title: 'Dno / Základňa',
    icon: '📦',
    description: 'Hrúbka dna a montážnej základne',
    params: [
      { key: 'bottomThickness', label: 'Hrúbka dna', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number' },
      { key: 'baseThickness', label: 'Hrúbka základne', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number', tooltip: 'Montážna základňa pod písmenom' },
    ],
  },
  {
    title: 'LED priestor',
    icon: '💡',
    description: 'Nastavenia dutiny pre LED moduly',
    params: [
      {
        key: 'ledModule', label: 'Typ LED modulu', type: 'select',
        options: [
          { value: '', label: 'Bez LED' },
          { value: 'smd_2835_front', label: 'SMD 2835 Front-lit' },
          { value: 'smd_2835_halo', label: 'SMD 2835 Halo' },
          { value: 'cob_front', label: 'COB LED strip' },
        ],
      },
      { key: 'ledCavityDepth', label: 'Hĺbka LED dutiny', unit: 'mm', min: 0, max: 100, step: 1, type: 'number' },
      { key: 'ledCavityOffset', label: 'Offset LED od čela', unit: 'mm', min: 0, max: 50, step: 0.5, type: 'number' },
      { key: 'ledBaseThickness', label: 'Hrúbka LED základne', unit: 'mm', min: 0, max: 10, step: 0.5, type: 'number' },
    ],
  },
  {
    title: 'Vnútorné výstuhy',
    icon: '🔩',
    description: 'Vnútorné steny a výstuhy pre stabilitu',
    params: [
      { key: 'innerLining', label: 'Vnútorné lemovanie', unit: 'mm', min: 0, max: 10, step: 0.1, type: 'number' },
      { key: 'internalWalls', label: 'Vnútorné steny', type: 'boolean', tooltip: 'Pridať vnútorné priečky pre stabilitu' },
      { key: 'ribSpacing', label: 'Rozstup výstuh', unit: 'mm', min: 20, max: 500, step: 5, type: 'number' },
      { key: 'minRibSize', label: 'Min. veľkosť pre výstuhy', unit: 'mm', min: 50, max: 500, step: 10, type: 'number' },
      { key: 'ribThickness', label: 'Hrúbka výstuh', unit: 'mm', min: 0.5, max: 5, step: 0.1, type: 'number' },
    ],
  },
  {
    title: 'Montáž',
    icon: '🪛',
    description: 'Montážne otvory a dištančné stĺpiky',
    params: [
      { key: 'mountingHoleDiameter', label: 'Priemer montážnej diery', unit: 'mm', min: 2, max: 10, step: 0.5, type: 'number', tooltip: 'M4 = 4.0mm, M5 = 5.0mm' },
      { key: 'mountingHoleSpacing', label: 'Rozstup dier', unit: 'mm', min: 30, max: 300, step: 5, type: 'number' },
      { key: 'mountingTabSize', label: 'Veľkosť úchytu', unit: 'mm', min: 5, max: 30, step: 1, type: 'number' },
      { key: 'standoffLength', label: 'Dĺžka dištancov', unit: 'mm', min: 5, max: 100, step: 1, type: 'number' },
    ],
  },
  {
    title: 'Vetranie',
    icon: '🌀',
    description: 'Ventilačné otvory pre odvádzanie tepla z LED',
    params: [
      { key: 'ventHoleDiameter', label: 'Priemer vent. otvorov', unit: 'mm', min: 0, max: 10, step: 0.5, type: 'number' },
      { key: 'ventHoleSpacing', label: 'Rozstup vent. otvorov', unit: 'mm', min: 0, max: 200, step: 5, type: 'number' },
    ],
  },
  {
    title: 'Segmentácia',
    icon: '✂️',
    description: 'Rozdelenie veľkých písmen na menšie kusy pre tlačiareň',
    params: [
      { key: 'maxSinglePiece', label: 'Max. veľkosť kusu', unit: 'mm', min: 100, max: 1000, step: 10, type: 'number', tooltip: 'Maximálna veľkosť jedného dielu (závisí od tlačiarne)' },
      {
        key: 'connectorType', label: 'Typ konektora', type: 'select',
        options: [
          { value: 'mortise_tenon', label: 'Pero-drážka (mortise-tenon)' },
          { value: 'pin', label: 'Kolík (pin)' },
          { value: 'tongue_groove', label: 'Drážka (tongue-groove)' },
        ],
      },
      { key: 'connectorDepth', label: 'Hĺbka konektora', unit: 'mm', min: 2, max: 30, step: 0.5, type: 'number' },
      { key: 'connectorTolerance', label: 'Tolerancia konektora', unit: 'mm', min: 0.05, max: 1, step: 0.05, type: 'number' },
    ],
  },
  {
    title: 'Geometria',
    icon: '📏',
    description: 'Presnosť generovania 3D geometrie',
    params: [
      { key: 'geometryPrecision', label: 'Presnosť kriviek', min: 4, max: 64, step: 1, type: 'number', tooltip: 'Počet subdivízií kriviek (vyššia = hladšia, ale pomalšia)' },
    ],
  },
];

const LIGHTING_TYPE_LABELS: Record<string, string> = {
  none: 'Bez podsvietenia',
  channel: 'Kanálové (bez LED)',
  channel_front: 'Kanálové (front-lit)',
  front: 'Predné (front-lit)',
  halo: 'Zadné (halo)',
  front_halo: 'Predné + zadné',
};

// ─────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="w-24 px-3 py-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg text-white text-sm focus:border-[#f59e0b] focus:outline-none transition-colors"
      />
      {unit && <span className="text-xs text-slate-500">{unit}</span>}
      {min !== undefined && max !== undefined && (
        <input
          type="range"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          min={min}
          max={max}
          step={step}
          className="flex-1 h-1.5 accent-[#f59e0b] cursor-pointer"
        />
      )}
    </div>
  );
}

function BooleanInput({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        value ? 'bg-[#f59e0b]' : 'bg-[#333]'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          value ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg text-white text-sm focus:border-[#f59e0b] focus:outline-none transition-colors cursor-pointer"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function SettingsPage() {
  const [presets, setPresets] = useState<ManufacturingPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [editedPreset, setEditedPreset] = useState<ManufacturingPreset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(PARAM_GROUPS.map(g => g.title)));

  // Fetch presets
  const fetchPresets = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/presets');
      const data = await res.json();
      setPresets(data.presets || []);

      // If no presets, seed them
      if (!data.presets || data.presets.length === 0) {
        setMessage({ type: 'success', text: 'Vytváram predvolené presety...' });
        const seedRes = await fetch('/api/presets/seed', { method: 'POST' });
        if (seedRes.ok) {
          const res2 = await fetch('/api/presets');
          const data2 = await res2.json();
          setPresets(data2.presets || []);
          setMessage({ type: 'success', text: 'Predvolené presety vytvorené!' });
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Chyba pri načítaní: ${err}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // Select preset
  useEffect(() => {
    if (selectedPresetId) {
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (preset) {
        setEditedPreset({ ...preset });
      }
    } else {
      setEditedPreset(null);
    }
  }, [selectedPresetId, presets]);

  // Update a field
  const updateField = (field: PresetField, value: unknown) => {
    if (!editedPreset) return;
    setEditedPreset({ ...editedPreset, [field]: value });
  };

  // Save preset
  const savePreset = async () => {
    if (!editedPreset) return;

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/presets/${editedPreset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedPreset),
      });

      if (res.ok) {
        const data = await res.json();
        // Update local state
        setPresets((prev) =>
          prev.map((p) => (p.id === data.preset.id ? data.preset : p)),
        );
        setMessage({ type: 'success', text: 'Preset uložený!' });
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.message || 'Chyba pri ukladaní' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Chyba: ${err}` });
    } finally {
      setSaving(false);
    }
  };

  // Create new preset
  const createPreset = async () => {
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nový preset',
          lightingType: 'none',
          wallThickness: 2.0,
          faceThickness: 2.0,
          backPanelThickness: 2.0,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPresets((prev) => [...prev, data.preset]);
        setSelectedPresetId(data.preset.id);
        setMessage({ type: 'success', text: 'Nový preset vytvorený!' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Chyba: ${err}` });
    }
  };

  // Delete preset
  const deletePreset = async (id: string) => {
    if (!confirm('Naozaj chcete vymazať tento preset?')) return;

    try {
      const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPresets((prev) => prev.filter((p) => p.id !== id));
        if (selectedPresetId === id) {
          setSelectedPresetId(null);
        }
        setMessage({ type: 'success', text: 'Preset vymazaný!' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Chyba: ${err}` });
    }
  };

  // Duplicate preset
  const duplicatePreset = async (preset: ManufacturingPreset) => {
    try {
      const { id, createdAt, updatedAt, ...rest } = preset as ManufacturingPreset & { createdAt: unknown; updatedAt: unknown };
      void id; void createdAt; void updatedAt;
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rest,
          name: `${preset.name} (kópia)`,
          isDefault: false,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPresets((prev) => [...prev, data.preset]);
        setSelectedPresetId(data.preset.id);
        setMessage({ type: 'success', text: 'Preset duplikovaný!' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Chyba: ${err}` });
    }
  };

  // Toggle expanded group
  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur border-b border-[#222]">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/configurator"
              className="text-slate-400 hover:text-white transition-colors flex items-center gap-2"
            >
              ← Konfigurátor
            </Link>
            <div className="h-5 w-px bg-[#333]" />
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              ⚙️ Výrobné nastavenia
            </h1>
          </div>

          {editedPreset && (
            <div className="flex items-center gap-3">
              {message && (
                <span
                  className={`text-sm px-3 py-1 rounded-full ${
                    message.type === 'success'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {message.text}
                </span>
              )}
              <button
                onClick={savePreset}
                disabled={saving}
                className="px-4 py-2 bg-[#f59e0b] hover:bg-[#d97706] text-black font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? '⏳ Ukladám...' : '💾 Uložiť zmeny'}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* ── Sidebar: preset list ── */}
        <aside className="w-72 flex-shrink-0">
          <div className="sticky top-20 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                Presety
              </h2>
              <button
                onClick={createPreset}
                className="text-xs px-2 py-1 bg-[#1a1a1a] border border-[#333] rounded-lg hover:border-[#f59e0b] transition-colors"
                title="Nový preset"
              >
                + Nový
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-slate-500">Načítavam...</div>
            ) : presets.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                Žiadne presety. Kliknite &quot;+ Nový&quot; pre vytvorenie.
              </div>
            ) : (
              <div className="space-y-1">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className={`group relative rounded-xl cursor-pointer transition-all ${
                      selectedPresetId === preset.id
                        ? 'bg-[#f59e0b]/10 border border-[#f59e0b]/40'
                        : 'bg-[#111] border border-[#222] hover:border-[#444]'
                    }`}
                  >
                    <div
                      className="p-3"
                      onClick={() => setSelectedPresetId(preset.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white truncate">
                            {preset.name}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {LIGHTING_TYPE_LABELS[preset.lightingType] || preset.lightingType}
                          </div>
                        </div>
                        {preset.isDefault && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#f59e0b]/10 text-[#f59e0b] rounded-full flex-shrink-0">
                            default
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 mt-1.5 text-[10px] text-slate-600">
                        <span>stena {preset.wallThickness}mm</span>
                        <span>·</span>
                        <span>čelo {preset.faceThickness}mm</span>
                        {(preset.externalWallRecess ?? 0) > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-[#f59e0b]">drážka {preset.externalWallRecess}mm</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicatePreset(preset);
                        }}
                        className="w-6 h-6 rounded bg-[#222] hover:bg-[#333] flex items-center justify-center text-[10px]"
                        title="Duplikovať"
                      >
                        📋
                      </button>
                      {!preset.isDefault && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePreset(preset.id);
                          }}
                          className="w-6 h-6 rounded bg-red-900/20 hover:bg-red-900/40 flex items-center justify-center text-[10px]"
                          title="Vymazať"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content: edit panel ── */}
        <main className="flex-1 min-w-0">
          {!editedPreset ? (
            <div className="flex items-center justify-center h-96 text-slate-500">
              <div className="text-center">
                <div className="text-5xl mb-4">⚙️</div>
                <p className="text-lg">Vyberte preset zo zoznamu vľavo</p>
                <p className="text-sm mt-1">alebo vytvorte nový</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Name & Type header */}
              <div className="bg-[#111] border border-[#222] rounded-2xl p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Názov presetu</label>
                    <input
                      type="text"
                      value={editedPreset.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-white focus:border-[#f59e0b] focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Typ podsvietenia</label>
                    <select
                      value={editedPreset.lightingType}
                      onChange={(e) => updateField('lightingType', e.target.value)}
                      className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-white focus:border-[#f59e0b] focus:outline-none transition-colors cursor-pointer"
                    >
                      {Object.entries(LIGHTING_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Popis</label>
                    <input
                      type="text"
                      value={editedPreset.description || ''}
                      onChange={(e) => updateField('description', e.target.value)}
                      className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#333] rounded-lg text-white focus:border-[#f59e0b] focus:outline-none transition-colors"
                      placeholder="Voliteľný popis..."
                    />
                  </div>
                </div>
              </div>

              {/* Parameter groups */}
              {PARAM_GROUPS.map((group) => {
                const isExpanded = expandedGroups.has(group.title);
                return (
                  <div
                    key={group.title}
                    className="bg-[#111] border border-[#222] rounded-2xl overflow-hidden"
                  >
                    {/* Group header */}
                    <button
                      onClick={() => toggleGroup(group.title)}
                      className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{group.icon}</span>
                        <div className="text-left">
                          <div className="text-sm font-semibold text-white">
                            {group.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {group.description}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-slate-500 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      >
                        ▼
                      </span>
                    </button>

                    {/* Group content */}
                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-3 border-t border-[#222]">
                        {group.params.map((param) => (
                          <div
                            key={param.key}
                            className="flex items-center justify-between gap-4 py-2"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-slate-300">
                                {param.label}
                              </div>
                              {param.tooltip && (
                                <div className="text-xs text-slate-600 mt-0.5">
                                  {param.tooltip}
                                </div>
                              )}
                            </div>

                            <div className="flex-shrink-0">
                              {param.type === 'number' && (
                                <NumberInput
                                  value={
                                    (editedPreset[param.key] as number) ?? 0
                                  }
                                  onChange={(v) => updateField(param.key, v)}
                                  min={param.min}
                                  max={param.max}
                                  step={param.step}
                                  unit={param.unit}
                                />
                              )}
                              {param.type === 'boolean' && (
                                <BooleanInput
                                  value={
                                    (editedPreset[param.key] as boolean) ??
                                    false
                                  }
                                  onChange={(v) => updateField(param.key, v)}
                                />
                              )}
                              {param.type === 'select' && param.options && (
                                <SelectInput
                                  value={
                                    (editedPreset[param.key] as string) || ''
                                  }
                                  onChange={(v) => updateField(param.key, v)}
                                  options={param.options}
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom save bar */}
              <div className="sticky bottom-4 bg-[#111]/90 backdrop-blur border border-[#333] rounded-2xl p-4 flex items-center justify-between">
                <div className="text-sm text-slate-400">
                  Preset: <span className="text-white font-medium">{editedPreset.name}</span>
                  {' · '}
                  <span className="text-slate-500">
                    {LIGHTING_TYPE_LABELS[editedPreset.lightingType] || editedPreset.lightingType}
                  </span>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      // Reset to original
                      const original = presets.find(p => p.id === editedPreset.id);
                      if (original) setEditedPreset({ ...original });
                    }}
                    className="px-4 py-2 bg-[#1a1a1a] border border-[#333] text-slate-300 rounded-lg hover:border-[#555] transition-colors text-sm"
                  >
                    Zahodiť zmeny
                  </button>
                  <button
                    onClick={savePreset}
                    disabled={saving}
                    className="px-6 py-2 bg-[#f59e0b] hover:bg-[#d97706] text-black font-medium rounded-lg transition-colors disabled:opacity-50 text-sm"
                  >
                    {saving ? '⏳ Ukladám...' : '💾 Uložiť'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
