#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) == 0 ]]; then
  printf '%s\n' '일반 SSH 사용자로 실행하세요. 필요한 OS 설치에만 sudo를 사용합니다.' >&2
  exit 1
fi
source /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 || $(uname -m) != x86_64 ]]; then
  printf '%s\n' '이 설치 절차는 Ubuntu 24.04 LTS x86_64 VM용입니다.' >&2
  exit 1
fi
koreai_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ "$koreai_repo" != "$HOME/koreai" ]]; then
  printf '%s\n' '저장소를 ~/koreai에 준비한 뒤 실행하세요.' >&2
  exit 1
fi
umask 077
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils
koreai_node_root="$HOME/.local/lib/koreai-node24"
if [[ -L "$koreai_node_root" ]]; then printf '%s\n' 'Node 설치 경로의 심볼릭 링크는 허용하지 않습니다.' >&2; exit 1; fi
mkdir -p "$koreai_node_root"
koreai_download=$(mktemp -d)
if [[ ! -x "$koreai_node_root/bin/node" ]]; then
  curl -fsS --retry 3 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$koreai_download/SHASUMS256.txt"
  koreai_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$koreai_download/SHASUMS256.txt")
  if [[ ! "$koreai_archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]; then printf '%s\n' 'Node 배포 파일을 확인하지 못했습니다.' >&2; exit 1; fi
  curl -fsS --retry 3 "https://nodejs.org/dist/latest-v24.x/$koreai_archive" -o "$koreai_download/$koreai_archive"
  (cd "$koreai_download"; sha256sum --ignore-missing --check --status SHASUMS256.txt)
  tar -xJf "$koreai_download/$koreai_archive" -C "$koreai_node_root" --strip-components=1
fi
export PATH="$koreai_node_root/bin:$PATH"
cd "$koreai_repo"
npm ci
npm run check
npm run build
# OS libraries use sudo internally; browser downloads belong to this SSH user.
npx playwright install --with-deps chromium

if ! command -v tailscale >/dev/null; then
  curl -fsS --retry 3 https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o "$koreai_download/tailscale-keyring.gpg"
  sudo install -m 0644 "$koreai_download/tailscale-keyring.gpg" /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsS --retry 3 https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o "$koreai_download/tailscale.list"
  sudo install -m 0644 "$koreai_download/tailscale.list" /etc/apt/sources.list.d/tailscale.list
  sudo apt-get update
  sudo apt-get install -y tailscale
fi
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/koreai" "$HOME/.local/share/koreai"
chmod 700 "$HOME/.config/koreai" "$HOME/.local/share/koreai"
install -m 0644 deploy/koreai-gcp.service "$HOME/.config/systemd/user/koreai.service"
sudo loginctl enable-linger "$(id -un)"
systemctl --user daemon-reload
systemctl --user enable --now koreai
printf '%s\n' '설치 완료. sudo tailscale up으로 로그인 후 bash deploy/enable-mobile.sh를 실행하세요.'
