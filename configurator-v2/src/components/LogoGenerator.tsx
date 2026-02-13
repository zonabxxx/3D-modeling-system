import { useState, useCallback, type FormEvent } from 'react';
import { generateLogo } from '@/lib/api';

interface LogoVariant {
  url: string;
  type: 'svg' | 'png';
  svgContent?: string;
  vectorized?: boolean;
  width?: number;
  height?: number;
}

interface Props {
  onLogoSelected: (variant: LogoVariant) => void;
}

export default function LogoGenerator({ onLogoSelected }: Props) {
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [style, setStyle] = useState('modern');
  const [variants, setVariants] = useState<LogoVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) return;
    setLoading(true);
    setError(null);
    setVariants([]);

    try {
      const data = await generateLogo({
        businessName: businessName.trim(),
        industry: industry.trim(),
        style,
        description: `3D svetelná reklama — logo pre „${businessName.trim()}"`,
        provider: 'openai',
        variantCount: 2,
      });

      if (data.variants?.length) {
        setVariants(data.variants);
      } else {
        setError('AI nevygenerovala žiadne varianty.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [businessName, industry, style]);

  return (
    <div className="space-y-3">
      <form onSubmit={handleGenerate} className="space-y-2">
        <input
          type="text"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Názov firmy / text"
          className="w-full px-3 py-2 rounded-lg bg-[#0a0f1a] border border-white/10 text-white text-sm placeholder-gray-500 focus:border-amber-500 outline-none"
        />
        <input
          type="text"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          placeholder="Odvetvie (voliteľné)"
          className="w-full px-3 py-2 rounded-lg bg-[#0a0f1a] border border-white/10 text-white text-sm placeholder-gray-500 focus:border-amber-500 outline-none"
        />
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[#0a0f1a] border border-white/10 text-white text-sm focus:border-amber-500 outline-none"
        >
          <option value="modern">Moderný / Minimalistický</option>
          <option value="bold">Tučný / Výrazný</option>
          <option value="elegant">Elegantný</option>
          <option value="playful">Hravý / Fun</option>
          <option value="corporate">Korporátny</option>
          <option value="vintage">Retro / Vintage</option>
        </select>

        <button
          type="submit"
          disabled={loading || !businessName.trim()}
          className="w-full px-3 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium disabled:opacity-50 hover:from-purple-500 hover:to-blue-500 transition-all"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⟳</span> Generujem…
            </span>
          ) : (
            '✨ Vygenerovať logo'
          )}
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {variants.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">Vyber variant:</p>
          <div className="grid grid-cols-2 gap-2">
            {variants.map((v, i) => (
              <button
                key={i}
                onClick={() => onLogoSelected(v)}
                className="relative rounded-lg border border-white/10 hover:border-amber-500/50 overflow-hidden bg-[#0a0f1a] p-2 transition-all group"
              >
                <img
                  src={v.url}
                  alt={`Variant ${i + 1}`}
                  className="w-full h-20 object-contain"
                />
                <span className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-black/50 text-gray-400">
                  {v.vectorized ? 'SVG' : v.type.toUpperCase()}
                </span>
                <span className="absolute bottom-0 inset-x-0 text-center text-[9px] py-0.5 bg-amber-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  Vybrať
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
