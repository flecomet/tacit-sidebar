#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# Tacit — Chrome Extension Build & Package Script
#
# Usage:  ./scripts/build-extension.sh [--skip-tests] [--force]
#
# Produces:  tacit-vX.Y.Z.zip  (ready for Chrome Web Store upload)
# ─────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Colours ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

info()  { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
fail()  { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }

# ── Flags ────────────────────────────────────────────────────────
SKIP_TESTS=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=true ;;
    --force)      FORCE=true ;;
    *)            fail "Unknown flag: $arg" ;;
  esac
done

# ── 1. Pre-flight checks ────────────────────────────────────────
info "Running pre-flight checks…"

# Verify we have the tools we need
command -v node >/dev/null 2>&1 || fail "node is not installed"
command -v npm  >/dev/null 2>&1 || fail "npm is not installed"
command -v zip  >/dev/null 2>&1 || fail "zip is not installed"

# Read version from package.json (source of truth)
VERSION=$(node -p "require('./package.json').version")
[[ -z "$VERSION" ]] && fail "Could not read version from package.json"
ZIP_NAME="tacit-v${VERSION}.zip"

info "Version: ${YELLOW}${VERSION}${NC}"

# Warn about uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  if [[ "$FORCE" == true ]]; then
    warn "Uncommitted changes detected (continuing with --force)"
  else
    fail "Uncommitted changes detected. Commit first or use --force"
  fi
fi

# Check if zip already exists
if [[ -f "$ZIP_NAME" ]]; then
  if [[ "$FORCE" == true ]]; then
    warn "Overwriting existing ${ZIP_NAME}"
    rm -f "$ZIP_NAME"
  else
    fail "${ZIP_NAME} already exists. Remove it first or use --force"
  fi
fi

ok "Pre-flight checks passed"

# ── 2. Sync version into manifest.json ──────────────────────────
MANIFEST="public/manifest.json"
MANIFEST_VERSION=$(node -p "require('./${MANIFEST}').version")

if [[ "$VERSION" != "$MANIFEST_VERSION" ]]; then
  info "Syncing manifest.json version: ${MANIFEST_VERSION} → ${VERSION}"
  # Use node to avoid sed portability issues
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('${MANIFEST}', 'utf8'));
    m.version = '${VERSION}';
    fs.writeFileSync('${MANIFEST}', JSON.stringify(m, null, 4) + '\n');
  "
  ok "manifest.json version updated to ${VERSION}"
else
  ok "manifest.json version already matches (${VERSION})"
fi

# ── 3. Install dependencies (if needed) ─────────────────────────
if [[ ! -d "node_modules" ]]; then
  info "Installing dependencies…"
  npm ci --silent
  ok "Dependencies installed"
else
  ok "node_modules present"
fi

# ── 4. Run tests ────────────────────────────────────────────────
if [[ "$SKIP_TESTS" == true ]]; then
  warn "Skipping tests (--skip-tests)"
else
  info "Running tests…"
  npm test || fail "Tests failed — fix before publishing"
  ok "All tests passed"
fi

# ── 5. Build ────────────────────────────────────────────────────
info "Building extension…"
npm run build || fail "Build failed"
ok "Build complete"

# ── 6. Validate dist output ─────────────────────────────────────
info "Validating build output…"

REQUIRED_FILES=(
  "dist/manifest.json"
  "dist/assets/sidepanel.js"
  "dist/assets/sidepanel.css"
  "dist/assets/background.js"
  "dist/assets/content.js"
  "dist/pdf.worker.min.js"
  "dist/favicon.png"
  "dist/favicon128.png"
  "dist/src/sidepanel/index.html"
)

MISSING=()
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    MISSING+=("$f")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  fail "Missing files in dist:\n$(printf '  - %s\n' "${MISSING[@]}")"
fi

# Verify manifest version in the built output
DIST_MANIFEST_VER=$(node -p "require('./dist/manifest.json').version")
if [[ "$DIST_MANIFEST_VER" != "$VERSION" ]]; then
  fail "dist/manifest.json version (${DIST_MANIFEST_VER}) doesn't match package.json (${VERSION})"
fi

ok "All required files present, manifest version verified"

# ── 7. Package into zip ─────────────────────────────────────────
info "Packaging ${ZIP_NAME}…"

cd dist
zip -r "../${ZIP_NAME}" . \
  -x "*.DS_Store" \
  -x "__MACOSX/*" \
  -x ".DS_Store"
cd "$ROOT_DIR"

# Sanity check zip size (should be ~500KB–2MB for this extension)
ZIP_SIZE=$(stat -f%z "$ZIP_NAME" 2>/dev/null || stat -c%s "$ZIP_NAME" 2>/dev/null)
ZIP_SIZE_KB=$((ZIP_SIZE / 1024))

if [[ $ZIP_SIZE_KB -lt 100 ]]; then
  fail "Zip is suspiciously small (${ZIP_SIZE_KB}KB) — something went wrong"
fi
if [[ $ZIP_SIZE_KB -gt 10240 ]]; then
  warn "Zip is large (${ZIP_SIZE_KB}KB) — check for unnecessary files"
fi

ok "Created ${ZIP_NAME} (${ZIP_SIZE_KB}KB)"

# ── 8. Summary ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Build complete: ${ZIP_NAME}${NC}"
echo -e "${GREEN}  Size: ${ZIP_SIZE_KB}KB${NC}"
echo -e "${GREEN}  Upload at: https://chrome.google.com/webstore/devconsole${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
