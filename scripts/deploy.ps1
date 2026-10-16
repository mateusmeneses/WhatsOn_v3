# Deploy do WhatsOn com gate de testes.
# Roda TODOS os testes (backend + frontend). Só faz o deploy se tudo passar.
# Uso:  pwsh scripts/deploy.ps1   (ou)   powershell -File scripts\deploy.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

Write-Host "==> 1/3  Testes do backend (jest)" -ForegroundColor Cyan
Push-Location "$root\backend"
npm test
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Testes do backend falharam." }
Pop-Location

Write-Host "`n==> 2/3  Testes + build do frontend (vitest + tsc + vite)" -ForegroundColor Cyan
Push-Location "$root\frontend"
npm run test
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Testes do frontend falharam." }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Build do frontend falhou." }
Pop-Location

Write-Host "`n==> 3/3  Todos os testes passaram. Subindo containers..." -ForegroundColor Green
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose falhou." }

Write-Host "`n[DEPLOY OK] Containers atualizados." -ForegroundColor Green
docker compose ps
