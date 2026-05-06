#!/usr/bin/env sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required. Install Python 3.9+ and try again." >&2
  exit 1
fi

python3 - <<'PY'
import sys

if sys.version_info < (3, 9):
    version = ".".join(str(part) for part in sys.version_info[:3])
    raise SystemExit("Error: Python 3.9+ is required. Found Python {}.".format(version))
PY

python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "Setup complete. Run: source .venv/bin/activate"
