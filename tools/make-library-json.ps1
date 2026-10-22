# Writes library.json (the BIOS list) for a server library folder.
# Usage: .\make-library-json.ps1 -Library D:\path\to\library [-Bios Bios]
param([Parameter(Mandatory)][string]$Library, [string]$Bios = 'Bios')
$root = (Resolve-Path $Library).Path.TrimEnd('\')
$files = Get-ChildItem (Join-Path $root $Bios) -Recurse -File | Where-Object { $_.Length -le 1MB } |
  ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
@{ catalog = 'catalog.sqlite'; bios = @($files) } | ConvertTo-Json | Set-Content (Join-Path $root 'library.json')
"wrote library.json with $(@($files).Count) BIOS files"
