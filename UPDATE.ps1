# Обновява играта до последната версия.
# Не се пуска директно - пусни UPDATE.bat.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo   = 'https://github.com/TikTokstar/proekt-koit-iskam-da-pravq-nz'
$branch = 'claude/guess-5-game-59p3ob'

Write-Host ''
Write-Host '  Сваляне на последната версия...'

$tmp = Join-Path $env:TEMP ('poznai5-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $zip = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -Uri "$repo/archive/refs/heads/$branch.zip" -OutFile $zip -UseBasicParsing

    # разархивираме в отделна подпапка, за да е ясно коя е папката на проекта
    $ext = Join-Path $tmp 'ext'
    New-Item -ItemType Directory -Path $ext -Force | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $ext -Force

    $src = Get-ChildItem -LiteralPath $ext -Directory | Select-Object -First 1
    if ($null -eq $src) { throw 'Архивът излезе празен.' }

    Write-Host '  Записване на файловете...'

    # robocopy слива папки надеждно, за разлика от Copy-Item
    $null = robocopy $src.FullName $root /E /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "Записването не успя (robocopy $LASTEXITCODE)." }

    # ако е добавена нова зависимост, тя се доставя при следващото пускане
    New-Item -ItemType File -Path (Join-Path $root 'server\.needs-install') -Force | Out-Null

    Write-Host ''
    Write-Host '  Готово! Всичко е обновено.'
    Write-Host '  Пусни START.bat както обикновено.'
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('  Обновяването не успя: ' + $_.Exception.Message)
    exit 1
}
finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
