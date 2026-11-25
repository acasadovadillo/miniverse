#!/bin/sh
# Writes src/world/homeroads.js: the roads round the village, worked out beforehand (src/world/roads.js), so that the first seconds of
# a game do not go into it. To be run again whenever the land, the sites or the roads change (the test "roads (english): those of home"
# says so). Without Node and without a browser: JavaScriptCore's shell, which comes with macOS.
# Usage: sh tools/homeroads.sh
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "no $JSC"; exit 1; }
S=$(mktemp -t shim) && M=$(mktemp -t homeroads).mjs && O=$(mktemp -t homeroads) || exit 1
echo 'globalThis.URLSearchParams = class { get() { return null; } }; globalThis.performance = { now: () => preciseTime() * 1000 };' > "$S"
cat > "$M" <<JS
import { Roads } from '$PWD/src/world/roads.js';
import { WORLD_SEED } from '$PWD/src/world/gen.js';
const R = new Roads(WORLD_SEED, false);
for (let cy = -26; cy <= 30; cy++) for (let cx = -26; cx <= 28; cx++) if ((cx - 1) ** 2 + (cy - 1) ** 2 < 29 ** 2) R.roadsIn(cx, cy);
print(R.packed());
JS
"$JSC" "$S" -m "$M" > "$O" && { echo '// Made by tools/homeroads.sh: do not edit (the roads round the village, worked out beforehand: roads.js, unpack)'; echo "export const HOME_SEED = 20261030;"; printf 'export const HOME_ROADS = %s;\n' "$(cat "$O")"; } > src/world/homeroads.js && wc -c src/world/homeroads.js
rm -f "$S" "$M" "$O"
