#!/usr/bin/env bash
# The secret scanner, pinned: gitleaks at one release, checked against its SHA-256 before it runs, over the
# repository's whole history. CI runs it; it exits non-zero on any finding or on a download that does not match.
set -euo pipefail
GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
tar="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
curl -sfL -o "$dir/$tar" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/$tar"
echo "${GITLEAKS_SHA256}  $dir/$tar" | sha256sum -c -
tar -xzf "$dir/$tar" -C "$dir" gitleaks
"$dir/gitleaks" git --no-banner --redact --exit-code 1 .
