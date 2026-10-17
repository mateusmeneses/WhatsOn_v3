# Deploy do WhatsOn com gate de testes e versão yyyy.MM.dd.N (mesmo padrão do MultiComércio).
# - Monta a versão com a DATA DE HOJE + o contador -N (você informa só o N).
# - Grava version.txt na raiz (fonte da verdade; exibido no app: rodapé, login, Novidades e /api/version).
# - Roda TODOS os testes (backend + frontend). Só faz o deploy se tudo passar.
# Lembre de registrar a versão em frontend/public/changelog.json (mantendo só as 3 mais recentes).
#
# Uso:  powershell -File scripts\deploy.ps1 -N 1        # -> 2026.10.17.1 (se hoje for 17/10/2026)
#       powershell -File scripts\deploy.ps1 -N 2 -Date 2026.10.17
param(
  [Parameter(Mandatory = $true)][int] $N,
  [string] $Date = (Get-Date -Format "yyyy.MM.dd")
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

$version = "$Date.$N"
if ($version -notmatch '^\d{4}\.\d{2}\.\d{2}\.\d+$') { Fail "Versão inválida: '$version'. Esperado yyyy.MM.dd.N (ex.: 2026.10.17.1)." }
Write-Host "==> Versão: $version" -ForegroundColor Cyan

& "$PSScriptRoot\test-gate.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }

# version.txt só é gravado depois do gate: deploy abortado não deixa versão nova para trás.
[System.IO.File]::WriteAllText((Join-Path $root "version.txt"), $version)
$env:APP_VERSION = $version
$env:APP_BUILD_TIME = Get-Date -Format "dd/MM/yyyy HH:mm"

Write-Host "`n==> Subindo containers..." -ForegroundColor Green
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Fail "docker compose falhou." }

Write-Host "`n[DEPLOY OK] Versão $version no ar (rodapé, login e /api/version)." -ForegroundColor Green
docker compose ps
