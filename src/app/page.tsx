import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Hero */}
      <div className="text-center max-w-3xl mx-auto animate-fade-in-up">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-[#f59e0b] to-[#d97706] rounded-2xl flex items-center justify-center shadow-lg shadow-[#f59e0b]/20">
            <span className="text-[#0a0a0a] font-bold text-3xl">A</span>
          </div>
        </div>

        <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
          Navrhni si{' '}
          <span className="text-gradient-orange">svetelnú reklamu</span>
          <br />
          z fotky fasády
        </h1>

        <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-2xl mx-auto">
          Nahraj fotku, zadaj text, vyber štýl a okamžite si pozri realistický 3D náhľad.
          Objednaj 3D písmená na mieru s LED podsvietením.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <a
            href="http://localhost:4321"
            target="_blank"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl btn-orange text-lg animate-pulse-orange"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Dizajnér V2 (Astro)
          </a>
          <Link
            href="/configurator"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-[#333] text-slate-400 hover:text-white hover:border-[#f59e0b] transition-colors"
          >
            🧊 Klasický konfigurátor
          </Link>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-[#333] text-slate-400 hover:text-white hover:border-[#f59e0b] transition-colors"
          >
            ⚙️ Nastavenia
          </Link>
        </div>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-20 px-4">
        <FeatureCard
          icon="📸"
          title="1. Nahraj fotku"
          description="Odfoť fasádu mobilom alebo nahraj existujúcu fotku. Označ miesto pre nápis."
        />
        <FeatureCard
          icon="✏️"
          title="2. Nastav text"
          description="Vyber font, farbu, 3D profil a typ podsvietenia. Všetko z overených predvolieb."
        />
        <FeatureCard
          icon="🧊"
          title="3. 3D náhľad"
          description="Okamžite vidíš realistický 3D náhľad priamo na tvojej fasáde. Uprav a objednaj."
        />
      </div>

      {/* Footer */}
      <footer className="mt-20 text-center text-slate-600 text-sm">
        <p>© 2026 ADSUN s.r.o. | 3D Konfigurátor svetelných reklám</p>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="glass rounded-2xl p-6 text-center hover:border-[#f59e0b]/30 transition-colors">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-slate-400">{description}</p>
    </div>
  );
}
