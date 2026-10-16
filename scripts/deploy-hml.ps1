# Deploy de homologação: https://hmlwhatson.connectmulti.com.br
# Mesmo fluxo do WhatsOn antigo (git fetch + reset no servidor, rebuild, health check),
# com gate de testes local e Docker no servidor.
#
# Uso:  powershell -File scripts\deploy-hml.ps1
# A autenticação SSH é sua: usa a chave ~/.ssh/whatson_hml se o servidor aceitar,
# senão o ssh pede a senha no terminal (uma vez só). Nenhuma senha fica gravada.
param(
  [string]$SshHost = "161.97.161.229",
  [string]$SshUser = "root",
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

# 1. O servidor faz pull do GitHub: o que vai pro ar é o origin/main, então ele precisa estar igual ao local.
Write-Host "==> Conferindo git (main limpo e enviado)" -ForegroundColor Cyan
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Fail "Há mudanças sem commit. Faça commit e push antes do deploy." }
git fetch -q origin main
$local = git rev-parse HEAD
$remote = git rev-parse origin/main
if ($local -ne $remote) { Fail "HEAD local ($local) diferente de origin/main ($remote). Faça push/pull antes." }
Write-Host "    commit: $(git log -1 --oneline)"

# 2. Gate de testes.
if (-not $SkipTests) {
  & "$PSScriptRoot\test-gate.ps1"
  if ($LASTEXITCODE -ne 0) { exit 1 }
} else {
  Write-Host "`n[AVISO] Testes pulados (-SkipTests)." -ForegroundColor Yellow
}

# 3. Executa o script remoto numa única sessão SSH.
Write-Host "`n==> Deploy remoto em $SshUser@$SshHost" -ForegroundColor Cyan
$sshArgs = @("-o", "ConnectTimeout=15")
$key = Join-Path $HOME ".ssh\whatson_hml"
if (Test-Path $key) { $sshArgs += @("-i", $key) }
$OutputEncoding = New-Object System.Text.UTF8Encoding $false   # PS 5.1 mandaria ASCII pelo pipe
$script = (Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\hml\remote-deploy.sh") -replace "`r`n", "`n"
$script | ssh @sshArgs "$SshUser@$SshHost" "tr -d '\r' > /tmp/whatson2-hml-deploy.sh && bash /tmp/whatson2-hml-deploy.sh"
if ($LASTEXITCODE -ne 0) { Fail "Script remoto falhou (código $LASTEXITCODE)." }

Write-Host "`n[DEPLOY OK] https://hmlwhatson.connectmulti.com.br" -ForegroundColor Green
