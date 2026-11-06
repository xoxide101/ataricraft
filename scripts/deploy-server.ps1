<#
 Deploys the web app to the private test server (copy-newer, never deletes, never mirrors).
   .\scripts\deploy-server.ps1 -WhatIf            dry run: lists what would be copied, the total size and the excluded paths
   .\scripts\deploy-server.ps1                    real copy
   .\scripts\deploy-server.ps1 -NoPersonal        skip font_personal\ and web\library\fonts\personal\ (optional)
   .\scripts\deploy-server.ps1 -IncludeSoftware   also copy software_n_roms\ to <server root>\software_n_roms\
 The server is private; git is the only restricted channel (see docs\DEPLOY.md).
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Target = '[private-deploy-target]',
  [switch]$NoPersonal,
  [switch]$IncludeSoftware,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$web = Join-Path $root 'web'
$srvRoot = Split-Path $Target -Parent          # ROMs live next to web/ (the app also probes ../roms/)
$dry = [bool]$WhatIfPreference
$WhatIfPreference = $false   # reads must run in the dry run; only the copy section is gated by $dry

# junk and build scratch that never goes to the server
$junkDir = '\\(node_modules|\.git|out|target|build|dist|\.vs|__pycache__)(\\|$)'
$junkFile = '(^|\\)(Thumbs\.db|desktop\.ini|\.DS_Store|.*\.(tmp|bak|log|lab|lst|map|swp))$'
# server-owned page: never overwritten
$keepServer = @('server.html')

# fresh generated font manifest + copies (personal fonts are included unless -NoPersonal)
Push-Location $root
try { node scripts\fontlist.cjs | Out-Null; node scripts\sync-xcwriter-core.cjs --check | Out-Null } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'xCWriter bundle is out of date: run node scripts\sync-xcwriter-core.cjs' }

$items = New-Object System.Collections.Generic.List[object]
$excluded = New-Object System.Collections.Generic.List[string]
function Add-Tree($srcDir, $dstRel, $skipRel) {
  if (-not (Test-Path $srcDir)) { return }
  $base = (Resolve-Path $srcDir).Path.TrimEnd('\')
  foreach ($f in Get-ChildItem $base -Recurse -File -Force) {
    $rel = $f.FullName.Substring($base.Length + 1)
    $full = if ($dstRel) { Join-Path $dstRel $rel } else { $rel }
    if ($rel -match $junkDir -or ('\' + $rel) -match $junkDir -or $rel -match $junkFile) { $excluded.Add("$($f.FullName)  (junk/build scratch)"); continue }
    if ($skipRel | Where-Object { $full -like $_ }) { $excluded.Add("$($f.FullName)  (excluded by switch)"); continue }
    $items.Add([pscustomobject]@{ Src = $f.FullName; Rel = $full; Len = $f.Length; Time = $f.LastWriteTimeUtc })
  }
}
function Add-File($src, $rel) {
  if (-not (Test-Path $src)) { return }
  $f = Get-Item $src; $items.Add([pscustomobject]@{ Src = $f.FullName; Rel = $rel; Len = $f.Length; Time = $f.LastWriteTimeUtc })
}

$skip = @($keepServer | ForEach-Object { $_ })
if ($NoPersonal) { $skip += 'library\fonts\personal\*'; $skip += 'library\fonts\local\personal\*' }
Add-Tree $web '' $skip
foreach ($k in $keepServer) { $excluded.Add("$web\$k  (server-owned, left alone)") }

# manifest without personal entries when -NoPersonal
$manifestOverride = $null
if ($NoPersonal) {
  $m = Get-Content (Join-Path $web 'library\fonts\local\manifest.json') -Raw | ConvertFrom-Json
  $m.groups = @($m.groups | Where-Object { $_.id -ne 'personal' })
  $manifestOverride = $m | ConvertTo-Json -Depth 8
}

# ACWriter: built program, demo and the fonts it can load, where the app's library expects Craft apps
$acw = 'library\craftapps\ACWriter'
Add-File (Join-Path $root 'tools\acwriter\poc5.xex') "$acw\POC5.XEX"
foreach ($f in Get-ChildItem (Join-Path $root 'font') -File -ErrorAction SilentlyContinue) { Add-File $f.FullName "$acw\FONTS\$($f.Name)" }
foreach ($f in Get-ChildItem (Join-Path $root 'tools\acwriter') -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(cwd|dic|ovl|fnt|acf)$' }) { Add-File $f.FullName "$acw\$($f.Name)" }
# dictionaries (EN.CDC, EN8.CDC) and the demo document, next to the program
foreach ($f in Get-ChildItem (Join-Path $root 'docs\samples') -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(cdc|cwd)$' }) { Add-File $f.FullName "$acw\$($f.Name)" }
if (-not $NoPersonal) { foreach ($f in Get-ChildItem (Join-Path $root 'font_personal') -File -ErrorAction SilentlyContinue) { Add-File $f.FullName "$acw\FONTS\PERSONAL\$($f.Name)" } }
else { $excluded.Add("$root\font_personal\*  (-NoPersonal)") }

# ROMs the app probes at <server root>\roms\ (the OS images it needs)
$romItems = @()
foreach ($f in Get-ChildItem (Join-Path $root 'roms') -Recurse -File -ErrorAction SilentlyContinue) {
  $items.Add([pscustomobject]@{ Src = $f.FullName; Rel = '..\roms\' + $f.FullName.Substring((Join-Path $root 'roms').Length + 1); Len = $f.Length; Time = $f.LastWriteTimeUtc })
}
if ($IncludeSoftware) {
  $sw = Join-Path $root 'software_n_roms'
  foreach ($f in Get-ChildItem $sw -Recurse -File -ErrorAction SilentlyContinue) {
    $items.Add([pscustomobject]@{ Src = $f.FullName; Rel = '..\software_n_roms\' + $f.FullName.Substring($sw.Length + 1); Len = $f.Length; Time = $f.LastWriteTimeUtc })
  }
} else { $excluded.Add("$root\software_n_roms\  (not needed at run time; use -IncludeSoftware)") }
foreach ($d in 'out', 'node_modules', '.git', 'target', 'books', 'local') { $excluded.Add("$root\$d\  (build scratch / not an app file)") }

# cache-busting: ?v=<content hash> on every local script/stylesheet the two pages load
function Stamp-Html($rel) {
  $p = Join-Path $web $rel; $dir = Split-Path $p -Parent
  $t = Get-Content $p -Raw
  [regex]::Replace($t, '(?<a>(?:src|href)=")(?<u>(?!https?:|//|/|data:)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"', {
      param($mm)
      $f = Join-Path $dir $mm.Groups['u'].Value
      if (-not (Test-Path $f)) { return $mm.Value }
      $h = (Get-FileHash $f -Algorithm SHA1).Hash.Substring(0, 8).ToLower()
      $mm.Groups['a'].Value + $mm.Groups['u'].Value + '?v=' + $h + '"'
    })
}
$stamped = @{}
foreach ($h in 'xcwriter.html', 'fontedit.html', 'ebookcraft.html') { $stamped[$h] = Stamp-Html $h }

# decide what needs copying (copy-newer: missing, different size, or older on the server)
$todo = New-Object System.Collections.Generic.List[object]
foreach ($it in $items) {
  $dst = Join-Path $Target $it.Rel
  $special = $stamped.ContainsKey($it.Rel) -or ($NoPersonal -and $it.Rel -eq 'library\fonts\local\manifest.json')
  if ($special) { continue }
  if (-not (Test-Path -LiteralPath $dst)) { $todo.Add($it); continue }
  $d = Get-Item -LiteralPath $dst
  if ($d.Length -ne $it.Len -or $d.LastWriteTimeUtc -lt $it.Time.AddSeconds(-2)) { $todo.Add($it) }
}
$total = ($todo | Measure-Object Len -Sum).Sum
$allTotal = ($items | Measure-Object Len -Sum).Sum

if (-not $Quiet) {
  $todo | ForEach-Object { '{0,12:N0}  {1}' -f $_.Len, $_.Rel }
  foreach ($h in $stamped.Keys) { '{0,12:N0}  {1}  (script/css links stamped with ?v=hash)' -f $stamped[$h].Length, $h }
  if ($NoPersonal) { '           -  library\fonts\local\manifest.json  (rewritten without the Personal group)' }
}
$exFile = Join-Path $root 'out\deploy-excluded.txt'
New-Item -ItemType Directory -Force (Split-Path $exFile) -WhatIf:$false | Out-Null
$excluded | Sort-Object | Set-Content $exFile -WhatIf:$false
'' ; "Target:            $Target"
"Files to copy:     $($todo.Count) of $($items.Count) candidates (rest already current on the server)"
"Size to copy:      {0:N1} MB   (all candidates {1:N1} MB)" -f ($total / 1MB), ($allTotal / 1MB)
"Excluded manifest: $exFile ($($excluded.Count) entries)"
if ($dry) { 'DRY RUN (-WhatIf): nothing was copied.'; return }

if (-not (Test-Path $Target)) { throw "Target not reachable: $Target" }
$n = 0
foreach ($it in $todo) {
  $dst = Join-Path $Target $it.Rel
  New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
  Copy-Item -LiteralPath $it.Src -Destination $dst -Force
  if ((++$n) % 200 -eq 0) { "copied $n / $($todo.Count)" }
}
foreach ($h in $stamped.Keys) { [IO.File]::WriteAllText((Join-Path $Target $h), $stamped[$h], (New-Object Text.UTF8Encoding($false))) }
if ($NoPersonal) { [IO.File]::WriteAllText((Join-Path $Target 'library\fonts\local\manifest.json'), $manifestOverride, (New-Object Text.UTF8Encoding($false))) }
"Copied $($todo.Count) files. Nothing was deleted on the server."
