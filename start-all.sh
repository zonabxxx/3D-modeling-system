#!/bin/bash
# ═══════════════════════════════════════════════════════
#  Spustí všetky 3 servery pre konfigurátor
#  Použitie:  ./start-all.sh
#  Zastavenie: Ctrl+C (zastaví všetky)
# ═══════════════════════════════════════════════════════

DIR="$(cd "$(dirname "$0")" && pwd)"
echo ""
echo "🚀 Spúšťam konfigurátor..."
echo "   📦 Python STL backend  → http://localhost:8000"
echo "   📦 Next.js API proxy   → http://localhost:3001"
echo "   📦 Astro frontend      → http://localhost:4323"
echo ""

# Kill any existing processes on these ports
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:4323 | xargs kill -9 2>/dev/null
sleep 1

# Trap Ctrl+C to kill all background processes
cleanup() {
  echo ""
  echo "🛑 Zastavujem všetky servery..."
  kill $PID_PYTHON $PID_NEXT 2>/dev/null
  wait $PID_PYTHON $PID_NEXT 2>/dev/null
  echo "✅ Všetko zastavené."
  exit 0
}
trap cleanup SIGINT SIGTERM

# 1) Python STL backend (port 8000)
(
  cd "$DIR/stl-generator"
  if [ -f venv/bin/activate ]; then
    source venv/bin/activate
  fi
  uvicorn app.main:app --reload --port 8000 2>&1 | sed 's/^/[Python 8000] /'
) &
PID_PYTHON=$!

# 2) Next.js API proxy (port 3001)
(
  cd "$DIR"
  npx next dev --port 3001 2>&1 | sed 's/^/[Next.js 3001] /'
) &
PID_NEXT=$!

# 3) Astro frontend (port 4323) - runs in foreground
sleep 2
echo ""
echo "✅ Python a Next.js štartujú na pozadí..."
echo "🌐 Astro frontend štartuje..."
echo ""
cd "$DIR/configurator-v2"
npx astro dev --port 4323 2>&1 | sed 's/^/[Astro  4323] /'

# If Astro exits, clean up
cleanup
