# Bundles v0.2.4, v0.2.5 and the working-tree Player for bench/run.mjs.
set -e
cd "$(dirname "$0")/.."
mkdir -p bench/.build/v024 bench/.build/v025
git show v0.2.4:audio.ts > bench/.build/v024/audio.ts
git show v0.2.5:audio.ts > bench/.build/v025/audio.ts
npx rolldown bench/.build/v024/audio.ts -f iife -n V024 -m -o bench/.build/v024.js >/dev/null
npx rolldown bench/.build/v025/audio.ts -f iife -n V025 -m -o bench/.build/v025.js >/dev/null
npx rolldown audio.ts -f iife -n VNEW -m -o bench/.build/vnew.js >/dev/null
