#!/bin/sh
# Quick checks before publishing, without Node and without a browser (seconds, not minutes):
#   1. the syntax of every module in src/ (JavaScriptCore's shell, which comes with macOS)
#   2. the language files are valid JSON
#   3. tools/i18n_check.py (pass --strict to also count Spanish text left in the code: it fails until F5)
# Usage: sh tools/gate.sh [--strict]
cd "$(dirname "$0")/.." || exit 1
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
bad=0
if [ -x "$JSC" ]; then
  checker=$(mktemp -t gate) || exit 1
  echo 'try { checkModuleSyntax(readFile(arguments[0])); } catch (e) { print(arguments[0] + ": " + e); }' > "$checker"
  out=$(find src -name '*.js' -print | sort | while read -r f; do "$JSC" "$checker" -- "$f"; done)
  rm -f "$checker"
  if [ -n "$out" ]; then echo "$out"; bad=1; else echo "syntax: all modules in src/ are fine"; fi
else
  echo "syntax: skipped (no $JSC)"
fi
for f in src/lang/*.json; do python3 -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$f" || { echo "$f: not valid JSON"; bad=1; }; done
python3 tools/i18n_check.py "$@" || bad=1
exit $bad
