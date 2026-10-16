# Inspeção somente leitura do servidor de homologação (Nginx, portas, SSL, apps).
param([string]$SshHost = "161.97.161.229", [string]$SshUser = "root")
$sshArgs = @("-o", "ConnectTimeout=15")
$key = Join-Path $HOME ".ssh\whatson_hml"
if (Test-Path $key) { $sshArgs += @("-i", $key) }
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$script = (Get-Content -Raw -Encoding UTF8 "$PSScriptRoot\hml\inspect.sh") -replace "`r`n", "`n"
$script | ssh @sshArgs "$SshUser@$SshHost" "tr -d '\r' > /tmp/whatson2-hml-inspect.sh && bash /tmp/whatson2-hml-inspect.sh"