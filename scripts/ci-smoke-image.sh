#!/usr/bin/env bash
# Boot smoke test of the built dashboard image, run by CI before the image is
# pushed. It needs a Docker daemon able to run the image's platform, nothing
# else (no secret, no backend):
#
#   scripts/ci-smoke-image.sh <image>
#
# Starts the container as production does (Caddy serving the static SPA, with
# the Caddyfile rendered from the build arguments) and checks, inside the
# container with its own busybox wget (the tool the image HEALTHCHECK uses):
#   1. /healthz answers: Caddy booted with a valid rendered Caddyfile.
#   2. / serves the SPA shell, which references a /_nuxt/ script.
#   3. that script is served as JavaScript (a missing file would fall back to
#      the HTML shell): the Nuxt build output made it into the image.
set -euo pipefail

image="${1:?usage: ci-smoke-image.sh <image>}"
timeout_s="${SMOKE_TIMEOUT:-60}"
port="${SMOKE_PORT:-3000}"
name="smoke-$$-$RANDOM"

cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && docker inspect "$name" >/dev/null 2>&1; then
    echo "::group::logs of $name"
    docker logs "$name" 2>&1 | tail -n 80 || true
    echo "::endgroup::"
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT

docker run -d --name "$name" "$image" >/dev/null

probe() {
  docker exec "$name" wget -qO- "http://127.0.0.1:$port$1"
}

deadline=$((SECONDS + timeout_s))
until probe /healthz >/dev/null 2>&1; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then
    echo "::error::the container exited before answering"
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::no answer on /healthz after ${timeout_s}s"
    exit 1
  fi
  sleep 1
done
echo "GET /healthz answered."

shell="$(probe /)"
script="$(grep -oE '/_nuxt/[A-Za-z0-9._-]+\.js' <<<"$shell" | head -n1 || true)"
if [ -z "$script" ]; then
  echo "::error::GET / did not return the SPA shell (no /_nuxt/ script referenced)"
  exit 1
fi
echo "GET / served the SPA shell."

# A missing file falls back to the SPA shell (HTTP 200), so the body must be
# JavaScript, not HTML.
asset="$(probe "$script" 2>/dev/null | head -c 64 || true)"
if [ -z "$asset" ] || grep -q '^[[:space:]]*<' <<<"$asset"; then
  echo "::error::GET $script did not return JavaScript: the build output is missing from the image"
  exit 1
fi
echo "GET $script served."
echo "Smoke test passed for $image."
