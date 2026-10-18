# Gate de testes do WhatsOn: backend (jest) + frontend (vitest + build).
# Sai com código 1 se qualquer etapa falhar. Usado por deploy.ps1 e deploy-hml.ps1.
#
# Quando passa, grava em .git/whatson-test-gate.ok a "impressão digital" do código testado
# (hash da árvore de trabalho, incluindo arquivos novos ainda não commitados). Se o próximo
# deploy encontrar exatamente o mesmo código, os testes são pulados; qualquer alteração em
# qualquer arquivo invalida o registro e o gate roda de novo. -Force roda sempre.
param([switch]$Force)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Fail($msg) { Write-Host "`n[DEPLOY ABORTADO] $msg" -ForegroundColor Red; exit 1 }

# Fora da impressão digital: o que o próprio deploy grava (version.txt) e estado local do Claude.
$excluded = @(":(exclude)version.txt", ":(exclude).claude")

$gitDir = (git -C $root rev-parse --absolute-git-dir).Trim()

function Get-CodeFingerprint {
  $index = Join-Path $gitDir "whatson-test-gate.index"
  $previous = $env:GIT_INDEX_FILE
  # Avisos do git no stderr (ex.: LF/CRLF) não podem abortar o gate no PowerShell 5.1.
  $ErrorActionPreference = "Continue"
  try {
    # Índice temporário: não mexe no staging do usuário. autocrlf desligado: hash do arquivo como está, sem avisos.
    $env:GIT_INDEX_FILE = $index
    git -C $root read-tree HEAD 2>$null
    git -C $root -c core.autocrlf=false -c core.safecrlf=false add -A -- . @excluded 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    # O índice parte do HEAD: tira também a cópia commitada dos excluídos (senão commitar o
    # version.txt novo mudaria a impressão digital de um código idêntico).
    git -C $root rm -r -q --cached --ignore-unmatch -- version.txt .claude 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $tree = (git -C $root write-tree 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $tree) { return $null }
    return $tree.Trim()
  } catch {
    return $null
  } finally {
    $env:GIT_INDEX_FILE = $previous
    Remove-Item $index -ErrorAction SilentlyContinue
  }
}

$stamp = Join-Path $gitDir "whatson-test-gate.ok"
$fingerprint = Get-CodeFingerprint

if (-not $Force -and $fingerprint -and (Test-Path $stamp)) {
  $last = (Get-Content $stamp -Raw).Trim()
  if ($last -eq $fingerprint) {
    Write-Host "==> Mesmo codigo ja aprovado no gate ($($fingerprint.Substring(0, 12))): testes pulados." -ForegroundColor Yellow
    Write-Host "    Para rodar mesmo assim: test-gate.ps1 -Force" -ForegroundColor Yellow
    exit 0
  }
}

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

# Registra só se o código não mudou durante os testes (senão o registro valeria para código não testado).
if ($fingerprint -and (Get-CodeFingerprint) -eq $fingerprint) {
  Set-Content -Path $stamp -Value $fingerprint -NoNewline -Encoding ascii
}

Write-Host "`n[GATE OK] Todos os testes passaram." -ForegroundColor Green
