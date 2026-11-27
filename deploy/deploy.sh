#!/usr/bin/env bash
# Usage: bash deploy/deploy.sh IMAGE
# IMAGE is ai-canvas:sha256-<portable config digest> and must already be loaded locally.
# receive-release.sh records the verified local store ID in deploy/releases/image-ids/.
set -Eeuo pipefail
APP=ai-canvas
DIR=/opt/projects/$APP
[[ $# -eq 1 ]] || { echo 'Usage: deploy.sh IMAGE' >&2; exit 2; }
image=$1
valid_image() { [[ "$1" =~ ^${APP}:sha256-([a-f0-9]{64})$ ]]; }
verify_local_image() {
  local reference=$1 actual expected record
  valid_image "$reference" || return 1
  expected="sha256:${BASH_REMATCH[1]}"
  record="$DIR/deploy/releases/image-ids/${BASH_REMATCH[1]}"
  if [[ -s "$record" ]]; then expected=$(cat "$record"); fi
  actual=$(docker image inspect --format '{{.Id}}' "$reference") || return 1
  [[ "$actual" == "$expected" ]] || { echo 'Local image ID does not match its immutable reference' >&2; return 1; }
}
valid_image "$image" || { echo 'Unexpected image reference' >&2; exit 2; }
cd "$DIR"
exec 9>deploy/.deploy.lock
flock -n 9 || { echo 'Another deployment is active'; exit 75; }
test -s deploy/runtime.env
test -s deploy/secrets/postgres-ca.pem
# Add checks for every bind-mounted path in docker-compose.yml, e.g.:
# test -d storage/data
# test -s deploy/secrets/db-ca.pem
mkdir -p deploy/releases
compose() { APP_IMAGE="$1" docker compose -f docker-compose.yml "${@:2}"; }
previous=''
if [[ -s deploy/current-image ]]; then
  previous=$(cat deploy/current-image)
  verify_local_image "$previous" || { echo 'Recorded rollback image is unavailable or invalid' >&2; exit 2; }
fi
compose "$image" config --quiet
verify_local_image "$image"
if compose "$image" up -d --no-build --pull never --wait --wait-timeout 180 app worker; then
  if [[ -n "$previous" && "$previous" != "$image" ]]; then printf '%s\n' "$previous" > deploy/previous-image; fi
  printf '%s\n' "$image" > deploy/current-image.tmp
  mv deploy/current-image.tmp deploy/current-image
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$image" >> deploy/releases/history.log
  echo 'Deployment healthy'
else
  echo 'Deployment failed; restoring previous image'
  if [[ -n "$previous" ]]; then
    compose "$previous" up -d --no-build --pull never --wait --wait-timeout 180 app worker || { echo 'ROLLBACK FAILED: operator intervention required'; exit 2; }
  else
    compose "$image" stop app worker
    echo 'First deployment failed; no previous image exists'
  fi
  exit 1
fi
