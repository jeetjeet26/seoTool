#!/usr/bin/env sh
set -eu

SF_HOME="${HOME}/.ScreamingFrogSEOSpider"
mkdir -p "${SF_HOME}"

if [ -n "${SCREAMING_FROG_LICENSE_B64:-}" ]; then
  printf '%s' "${SCREAMING_FROG_LICENSE_B64}" | base64 --decode > "${SF_HOME}/licence.txt"
  chmod 600 "${SF_HOME}/licence.txt"
fi

if [ ! -s "${SF_HOME}/licence.txt" ]; then
  echo "Screaming Frog licence is missing. Set SCREAMING_FROG_LICENSE_B64." >&2
  exit 1
fi

export SCREAMING_FROG_PATH="${SCREAMING_FROG_PATH:-/usr/bin/screamingfrogseospider}"

echo "entrypoint: licence installed, launching worker under xvfb-run"

exec xvfb-run -a python -m worker.main
