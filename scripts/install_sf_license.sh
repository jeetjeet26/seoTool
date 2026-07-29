#!/usr/bin/env sh
# Writes the Screaming Frog licence locally and prints the base64 value for
# the Render worker (SCREAMING_FROG_LICENSE_B64).
#
# Usage: set SCREAMING_FROG_LICENSE_USERNAME and SCREAMING_FROG_LICENSE_KEY in
# .env (or the environment), then run: sh scripts/install_sf_license.sh
set -eu

env_value() {
  # Reads KEY=value from .env without sourcing it (paths may contain spaces).
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1
}

USERNAME="${SCREAMING_FROG_LICENSE_USERNAME:-$(env_value SCREAMING_FROG_LICENSE_USERNAME)}"
KEY="${SCREAMING_FROG_LICENSE_KEY:-$(env_value SCREAMING_FROG_LICENSE_KEY)}"

if [ -z "$USERNAME" ] || [ -z "$KEY" ]; then
  echo "Set SCREAMING_FROG_LICENSE_USERNAME and SCREAMING_FROG_LICENSE_KEY first." >&2
  echo "The username is the account name the licence was issued to." >&2
  exit 1
fi

SF_HOME="${HOME}/.ScreamingFrogSEOSpider"
mkdir -p "$SF_HOME"
printf '%s\n%s\n' "$USERNAME" "$KEY" > "$SF_HOME/licence.txt"
chmod 600 "$SF_HOME/licence.txt"
echo "Wrote $SF_HOME/licence.txt"

echo
echo "Render worker env value (SCREAMING_FROG_LICENSE_B64):"
printf '%s\n%s\n' "$USERNAME" "$KEY" | base64
