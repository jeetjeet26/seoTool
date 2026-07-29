#!/usr/bin/env sh
set -eu

SF_HOME="${HOME}/.ScreamingFrogSEOSpider"

# Screaming Frog home stays ephemeral (container filesystem) so corrupt crawl
# state can never break future runs. Only the licence identity files persist
# on the disk, keeping one stable machine lease across deploys.
mkdir -p "${SF_HOME}"

PERSIST_DIR=""
if [ -d /var/data ]; then
  PERSIST_DIR="/var/data/screamingfrog-identity"
  mkdir -p "${PERSIST_DIR}"
fi

# link_identity FILE: store FILE on the persistent disk and symlink it into
# the ephemeral SF home so Screaming Frog reads/writes the persistent copy.
link_identity() {
  if [ -n "${PERSIST_DIR}" ]; then
    ln -sf "${PERSIST_DIR}/$1" "${SF_HOME}/$1"
  fi
}

identity_path() {
  if [ -n "${PERSIST_DIR}" ]; then
    printf '%s' "${PERSIST_DIR}/$1"
  else
    printf '%s' "${SF_HOME}/$1"
  fi
}

if [ -n "${SCREAMING_FROG_LICENSE_B64:-}" ]; then
  printf '%s' "${SCREAMING_FROG_LICENSE_B64}" | base64 --decode > "$(identity_path licence.txt)"
  chmod 600 "$(identity_path licence.txt)"
fi
link_identity licence.txt

# Adopt an existing machine identity/lease so the licence server renews an
# already-granted lease instead of allocating a new machine seat.
if [ -n "${SCREAMING_FROG_MACHINE_ID:-}" ]; then
  printf '%s' "${SCREAMING_FROG_MACHINE_ID}" > "$(identity_path machine-id.txt)"
fi
link_identity machine-id.txt

# Seed the lease only if none is stored yet; Screaming Frog renews it in place.
if [ -n "${SCREAMING_FROG_LEASE_B64:-}" ] && [ ! -s "$(identity_path lease.json)" ]; then
  printf '%s' "${SCREAMING_FROG_LEASE_B64}" | base64 --decode > "$(identity_path lease.json)"
fi
link_identity lease.json

if [ ! -s "${SF_HOME}/licence.txt" ]; then
  echo "Screaming Frog licence is missing. Set SCREAMING_FROG_LICENSE_B64." >&2
  exit 1
fi

# Accept the EULA for headless operation (no GUI to click through) and use
# database storage mode so crawl data lives on disk instead of the Java heap
# (memory mode exhausts the 1GB heap and aborts crawls on this instance).
SF_DB_DIR="/tmp/sf-crawl-db"
if [ -d /var/data ]; then
  SF_DB_DIR="/var/data/sf-crawl-db"
fi
rm -rf "${SF_DB_DIR}"
mkdir -p "${SF_DB_DIR}"
{
  printf 'eula.accepted=15\n'
  printf 'storage.mode=DB\n'
  printf 'storage.db_dir=%s\n' "${SF_DB_DIR}"
} > "${SF_HOME}/spider.config"

# Cap the Java heap below the instance's physical memory, otherwise Screaming
# Frog refuses to start (default is 2GB on a 2GB instance).
SF_MEMORY="${SCREAMING_FROG_MEMORY:--Xmx1g}"
printf '%s\n' "${SF_MEMORY}" > "${HOME}/.screamingfrogseospider"

export SCREAMING_FROG_PATH="${SCREAMING_FROG_PATH:-/usr/bin/screamingfrogseospider}"

echo "entrypoint: licence installed, starting Xvfb"

# Screaming Frog documents DISPLAY=:0 for Linux headless operation. Wait for
# the X11 socket before launching the worker so image processing cannot race
# the virtual display startup.
export DISPLAY=:0
rm -f /tmp/.X0-lock
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!

attempt=0
while [ ! -S /tmp/.X11-unix/X0 ]; do
  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "Xvfb exited before its display became ready." >&2
    wait "${XVFB_PID}" || true
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 100 ]; then
    echo "Timed out waiting for Xvfb display :0." >&2
    exit 1
  fi
  sleep 0.1
done

echo "entrypoint: launching worker"

exec python -m worker.main
