#!/usr/bin/env sh
set -eu

SF_HOME="${HOME}/.ScreamingFrogSEOSpider"

# Keep Screaming Frog state (machine id, licence lease) on the persistent disk
# so redeploys don't request a new licence lease every time.
if [ -d /var/data ]; then
  mkdir -p /var/data/screamingfrog
  rm -rf "${SF_HOME}"
  ln -s /var/data/screamingfrog "${SF_HOME}"
else
  mkdir -p "${SF_HOME}"
fi

if [ -n "${SCREAMING_FROG_LICENSE_B64:-}" ]; then
  printf '%s' "${SCREAMING_FROG_LICENSE_B64}" | base64 --decode > "${SF_HOME}/licence.txt"
  chmod 600 "${SF_HOME}/licence.txt"
fi

if [ ! -s "${SF_HOME}/licence.txt" ]; then
  echo "Screaming Frog licence is missing. Set SCREAMING_FROG_LICENSE_B64." >&2
  exit 1
fi

export SCREAMING_FROG_PATH="${SCREAMING_FROG_PATH:-/usr/bin/screamingfrogseospider}"

echo "entrypoint: licence installed, starting Xvfb"

# Start a virtual display for Screaming Frog; don't block worker startup on it.
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
export DISPLAY=:99

echo "entrypoint: launching worker"

exec python -m worker.main
