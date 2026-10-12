#!/usr/bin/env bash
set -euo pipefail
if [[ $(id -u) == 0 ]]; then printf '%s\n' '설치한 일반 SSH 사용자로 실행하세요.' >&2; exit 1; fi
koreai_node="$HOME/.local/lib/koreai-node24/bin/node"
koreai_dns=$(tailscale status --json | "$koreai_node" -e '
let input=""; process.stdin.on("data",chunk=>input+=chunk); process.stdin.on("end",()=>{
  const status=JSON.parse(input), name=status.Self?.DNSName?.replace(/\.$/,"");
  if(status.BackendState!=="Running" || !name || !/^[a-z0-9.-]+\.ts\.net$/i.test(name))process.exit(1);
  process.stdout.write(name);
});')
umask 077
mkdir -p "$HOME/.config/koreai"
printf 'KOREAI_PUBLIC_URL=https://%s\n' "$koreai_dns" > "$HOME/.config/koreai/server.env"
systemctl --user restart koreai
sudo tailscale serve --bg http://127.0.0.1:4318
printf '휴대폰 접속 주소: https://%s\n' "$koreai_dns"
printf '%s\n' '휴대폰 Tailscale 로그인 후 위 주소를 여세요. 연결 코드는 아래 관리 화면 로그에서 확인합니다.'
journalctl --user -u koreai -n 12 --no-pager
