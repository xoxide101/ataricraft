# Writes library.json (the BIOS and BASIC ROM list) for a server library folder.
# Usage: .\make-library-json.ps1 -Library D:\path\to\library [-Folders bios,basic]
param([Parameter(Mandatory)][string]$Library, [string[]]$Folders = @('bios', 'basic'))
$root = (Resolve-Path $Library).Path.TrimEnd('\')
$files = foreach ($f in $Folders) {
  $d = Join-Path $root $f
  if (Test-Path $d) { Get-ChildItem $d -Recurse -File | Where-Object { $_.Length -le 1MB } | ForEach-Object { $_.FullName.Substring($root.Length + 1).Replace('\', '/') } }
}
@{ catalog = 'catalog.sqlite'; bios = @($files) } | ConvertTo-Json | Set-Content (Join-Path $root 'library.json')
"wrote library.json with $(@($files).Count) ROM files"
