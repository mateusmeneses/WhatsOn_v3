# Gate de testes do WhatsOn: backend (jest) + frontend (vitest + build).
# Sai com código 1 se qualquer etapa falhar. Usado por deploy.ps1 e deploy-hml.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

Write-Host "==> Testes do backend (jest)" -ForegroundColor Cyan
Push-Location "$root\backend"
npm test
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Testes do backend falharam." }
Pop-Location

Write-Host "`n==> Testes + build do frontend (vitest + tsc + vite)" -ForegroundColor Cyan
Push-Location "$root\frontend"
npm run test
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Testes do frontend falharam." }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Build do frontend falhou." }
Pop-Location

Write-Host "`n[GATE OK] Todos os testes passaram." -ForegroundColor Green
