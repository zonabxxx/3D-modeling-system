#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "📁 Working directory: $(pwd)"

# 1. Initialize git
if [ ! -d .git ]; then
  echo "🔧 Initializing git repository..."
  git init
else
  echo "✅ Git already initialized"
fi

# 2. Add remote
if ! git remote get-url origin 2>/dev/null; then
  echo "🔗 Adding GitHub remote..."
  git remote add origin https://github.com/zonabxxx/3D-modeling-system.git
else
  echo "✅ Remote 'origin' already exists: $(git remote get-url origin)"
fi

# 3. Set branch to main
git branch -M main

# 4. Add all files (respecting .gitignore)
echo "📦 Adding files..."
git add -A

# 5. Show what will be committed
echo ""
echo "📋 Files to commit:"
git status --short | head -50
TOTAL=$(git status --short | wc -l | tr -d ' ')
echo "   ... Total: $TOTAL files"
echo ""

# 6. Commit
echo "💾 Creating initial commit..."
git commit -m "🚀 Initial commit: 3D Sign Configurator

Features:
- 3D sign configurator with Three.js preview
- STL generation for 3D printing (hollow letters, mounting, acrylic grooves)
- AI logo generation (OpenAI + Recraft V3)
- PNG to SVG vectorization (Potrace)
- Manufacturing presets management
- SVG/text to 3D extrusion pipeline
- Python FastAPI backend with CadQuery
- Next.js 15 + React 19 frontend"

# 7. Push
echo "🚀 Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Successfully pushed to https://github.com/zonabxxx/3D-modeling-system"
