'use client';

/**
 * PriceDisplay – Real-time cenový výpočet
 *
 * Napojený na pricing-calculator.ts, zobrazuje buď:
 * - compact: len celkovú cenu + cenu za položku
 * - full: kompletný cenový rozpis so všetkými položkami
 */

import { useMemo } from 'react';
import { useConfiguratorStore } from '@/stores/configurator-store';
import { calculatePrice, quickEstimate } from '@/lib/pricing-calculator';
import type { PriceCalculationInput } from '@/lib/pricing-calculator';

// Metalické RAL kódy
const METALLIC_RALS = new Set([
  'GOLD', 'SILVER', 'ROSE_GOLD', 'COPPER', 'CHROME',
  'RAL 9006', 'RAL 9007',
]);

export default function PriceDisplay({ compact = false }: { compact?: boolean }) {
  const text = useConfiguratorStore((s) => s.text);
  const depthMm = useConfiguratorStore((s) => s.depthMm);
  const profileType = useConfiguratorStore((s) => s.profileType);
  const lightingType = useConfiguratorStore((s) => s.lightingType);
  const faceRal = useConfiguratorStore((s) => s.faceRal);
  const computed = useConfiguratorStore((s) => s.computed);
  const order = useConfiguratorStore((s) => s.order);
  const contentType = useConfiguratorStore((s) => s.contentType);
  const logo = useConfiguratorStore((s) => s.logo);

  const letterCount = text.replace(/\s/g, '').length;
  const letterHeight = computed.letterHeightMm || 200;
  const hasLogo = contentType !== 'text_only' && !!(logo.svgUrl || logo.rasterUrl);

  // Full price calculation
  const priceBreakdown = useMemo(() => {
    if (letterCount === 0 && !hasLogo) return null;

    const input: PriceCalculationInput = {
      letterCount: Math.max(letterCount, 0),
      letterHeightMm: letterHeight,
      totalWidthMm:
        contentType === 'logo_only' && logo.originalWidth > 0 && logo.originalHeight > 0
          ? letterHeight * (logo.originalWidth / logo.originalHeight) * logo.logoScale
          : letterHeight * 0.65 * Math.max(letterCount, 1),
      depthMm,
      profileType,
      lightingType,
      colorCategory: METALLIC_RALS.has(faceRal) ? 'metallic' : 'standard',
      includeInstallation: order.type === 'production_and_installation',
      installationHeightM: 3,
      hasLogo,
      logoAreaMm2:
        computed.logoAreaMm2 || (hasLogo ? letterHeight * letterHeight * 0.7 : 0),
      logoIsRelief: logo.extrudeAsRelief,
      logoComplexity: 1.0,
    };

    return calculatePrice(input);
  }, [
    letterCount, letterHeight, depthMm, profileType, lightingType,
    faceRal, order.type, hasLogo, computed.logoAreaMm2, logo.extrudeAsRelief,
  ]);

  // Quick estimate (for when there's no full calculation)
  const estimate = useMemo(
    () => quickEstimate(Math.max(letterCount, 1), letterHeight, lightingType),
    [letterCount, letterHeight, lightingType],
  );

  // ── No data yet ──
  if (!priceBreakdown) {
    return (
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-2">Orientačná cena</h3>
        <p className="text-2xl font-bold text-[#f59e0b]">
          ~{estimate.min}–{estimate.max} €
        </p>
        <p className="text-xs text-slate-500 mt-1">Zadajte text pre presný výpočet</p>
      </div>
    );
  }

  // ── Compact mode ──
  if (compact) {
    return (
      <div className="glass rounded-xl p-4">
        <h3 className="text-sm font-medium text-slate-400 mb-2">Celková cena</h3>
        <p className="text-3xl font-bold text-[#f59e0b]">
          {priceBreakdown.totalPrice.toFixed(2)} €
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {letterCount > 0 && `${letterCount} písmen`}
          {letterCount > 0 && hasLogo && ' + '}
          {hasLogo && 'logo'}
          {' · '}
          {priceBreakdown.pricePerItem.toFixed(2)} €/položka
        </p>
      </div>
    );
  }

  // ── Full breakdown ──
  return (
    <div className="glass rounded-xl p-5 space-y-3">
      <h3 className="text-sm font-medium text-slate-300">Cenový rozpis</h3>

      <div className="space-y-2 text-sm">
        <PriceRow label="Materiál" value={priceBreakdown.materialCost} detail={priceBreakdown.materialDetails} />
        <PriceRow label="Práca" value={priceBreakdown.laborCost} detail={`${priceBreakdown.laborHours}h`} />

        {priceBreakdown.logoCost > 0 && (
          <PriceRow label="Logo" value={priceBreakdown.logoCost} detail={priceBreakdown.logoDetails} />
        )}

        {priceBreakdown.ledCost > 0 && (
          <PriceRow
            label="LED podsvit"
            value={priceBreakdown.ledCost}
            detail={`${priceBreakdown.ledModulesCount} modulov`}
          />
        )}

        <PriceRow label="Náter" value={priceBreakdown.paintCost} />
        <PriceRow label="Dizajn" value={priceBreakdown.designFee} />
        <PriceRow label="Balenie" value={priceBreakdown.packagingCost} />
        <PriceRow label="Doprava" value={priceBreakdown.shippingCost} />

        {priceBreakdown.installationCost > 0 && (
          <PriceRow label="Montáž" value={priceBreakdown.installationCost} />
        )}

        {/* Total */}
        <div className="border-t border-[#2a2a2a] pt-2 mt-2">
          <div className="flex justify-between text-lg font-bold">
            <span className="text-white">Celkom</span>
            <span className="text-[#f59e0b]">{priceBreakdown.totalPrice.toFixed(2)} €</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {letterCount > 0 && `${priceBreakdown.pricePerLetter.toFixed(2)} €/písmeno`}
            {letterCount > 0 && hasLogo && ' · '}
            {hasLogo && `logo ${priceBreakdown.logoCost.toFixed(2)} €`}
          </div>
        </div>
      </div>

      {/* Profile multiplier note */}
      {priceBreakdown.profileMultiplier > 1 && (
        <div className="text-xs text-slate-500 bg-slate-800/30 rounded-lg px-3 py-2">
          Profil prirážka: ×{priceBreakdown.profileMultiplier.toFixed(2)}
        </div>
      )}

      {/* Color multiplier note */}
      {priceBreakdown.colorMultiplier > 1 && (
        <div className="text-xs text-slate-500 bg-slate-800/30 rounded-lg px-3 py-2">
          Metalická farba: ×{priceBreakdown.colorMultiplier.toFixed(2)}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Price row
// ──────────────────────────────────────────────

function PriceRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between items-center">
      <div>
        <span className="text-slate-400">{label}</span>
        {detail && (
          <span className="text-slate-600 text-xs ml-1.5">({detail})</span>
        )}
      </div>
      <span className="text-white tabular-nums">{value.toFixed(2)} €</span>
    </div>
  );
}
