param([string]$In, [string]$Dump, [string]$Saved)
# Opens an xlsx in Excel (COM), recalculates, dumps every used cell, and saves a copy. Used by scripts/calc-excel-test.cjs.
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($In)
  $xl.CalculateFull()
  $out = @()
  foreach ($ws in $wb.Worksheets) {
    $ur = $ws.UsedRange
    $ws.Columns.AutoFit() | Out-Null
    foreach ($c in $ur.Cells) {
      if ($c.Formula -eq '' -and $c.Value2 -eq $null) { continue }
      $v = $c.Value2
      $isErr = $false
      if ($v -is [int]) { $isErr = $true; $v = $c.Text }
      $out += [pscustomobject]@{ sheet = $ws.Name; addr = $c.Address($false, $false); f = $c.Formula; v = $v; err = $isErr; text = $c.Text; fmt = $c.NumberFormat; bold = [bool]$c.Font.Bold; italic = [bool]$c.Font.Italic; ul = ($c.Font.Underline -ne -4142); ha = $c.HorizontalAlignment }
    }
  }
  $out | ConvertTo-Json -Depth 3 | Set-Content -Path $Dump -Encoding UTF8
  if ($Saved) { $wb.SaveAs($Saved, 51) }
  $wb.Close($false)
} finally { $xl.Quit(); [void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) }
