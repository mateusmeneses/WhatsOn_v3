# Deploy do WhatsOn com gate de testes.
# Roda TODOS os testes (backend + frontend). Só faz o deploy se tudo passar.
# Uso:  pwsh scripts/deploy.ps1   (ou)   powershell -File scripts\deploy.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

& "$PSScriptRoot\test-gate.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`n==> Subindo containers..." -ForegroundColor Green
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose falhou." }

Write-Host "`n[DEPLOY OK] Containers atualizados." -ForegroundColor Green
docker compose ps
