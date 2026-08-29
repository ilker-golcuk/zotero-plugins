#!/usr/bin/env bash
# Cut a release for one plugin.
#
#   ./release.sh ref-verifier
#
# update.json is REGENERATED from the manifests every time rather than edited by
# hand. Hand-editing is how these drift: bump the version but leave update_link
# on the old tag and Zotero announces an update, then downloads the old build.
set -euo pipefail

REPO="ilker-golcuk/zotero-plugins"
cd "$(dirname "$0")"

PLUGIN="${1:-}"
[ -d "$PLUGIN" ] || { echo "usage: ./release.sh <ref-verifier|pdf-exporter>" >&2; exit 1; }

version() { python3 -c "import json;print(json.load(open('$1/manifest.json'))['version'])"; }

VER="$(version "$PLUGIN")"
TAG="$PLUGIN-v$VER"
XPI="$(mktemp -d)/$PLUGIN.xpi"

echo "==> $PLUGIN $VER  ->  $TAG"

# Build from the working tree, but refuse to ship uncommitted plugin sources:
# a release must be reproducible from the tag it claims to come from.
if ! git diff --quiet -- "$PLUGIN" || ! git diff --cached --quiet -- "$PLUGIN"; then
  echo "!! $PLUGIN has uncommitted changes. Commit them first." >&2
  exit 1
fi

( cd "$PLUGIN" && zip -qr "$XPI" manifest.json bootstrap.js chrome )
echo "    built $(wc -c <"$XPI" | tr -d ' ') bytes"

# Regenerate update.json from every plugin's manifest.
python3 - <<'PY'
import json, os, collections
REL = "https://github.com/ilker-golcuk/zotero-plugins/releases/download"
addons = {}
for d in sorted(x for x in os.listdir(".") if os.path.isfile(f"{x}/manifest.json")):
    m = json.load(open(f"{d}/manifest.json"))
    z = m["applications"]["zotero"]
    addons[z["id"]] = {"updates": [{
        "version": m["version"],
        "update_link": f"{REL}/{d}-v{m['version']}/{d}.xpi",
        "applications": {"zotero": {
            "strict_min_version": z["strict_min_version"],
            "strict_max_version": z["strict_max_version"]}}}]}
json.dump({"addons": addons}, open("update.json", "w"), indent=2)
open("update.json", "a").write("\n")
PY
echo "    update.json regenerated"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "    replacing existing release $TAG"
  gh release upload "$TAG" "$XPI" --clobber -R "$REPO"
else
  gh release create "$TAG" "$XPI" -R "$REPO" \
    --title "$(python3 -c "import json;print(json.load(open('$PLUGIN/manifest.json'))['name'])") $VER" \
    --notes "Install: Zotero → Tools → Plugins → gear → Install Plugin From File… → \`$PLUGIN.xpi\`

Built from \`$PLUGIN/\` at this tag."
fi

if ! git diff --quiet -- update.json; then
  git add update.json
  git commit -qm "Update update.json for $TAG"
  git push -q
  echo "    update.json committed and pushed"
fi

echo "==> done: https://github.com/$REPO/releases/tag/$TAG"
