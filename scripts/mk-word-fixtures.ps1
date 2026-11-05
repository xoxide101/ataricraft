# Builds real Word fixtures (rich.doc/.docx/.rtf and long.rtf) in out\rt\ through Word COM, and converts exported files to PDF.
# Usage: powershell -File scripts\mk-word-fixtures.ps1 [-Validate file1 file2 ...]
param([string[]]$Validate)
$out = Join-Path $PSScriptRoot '..\out\rt'; New-Item -ItemType Directory -Force $out | Out-Null; $out = (Resolve-Path $out).Path
$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
try {
  if ($Validate) {
    foreach ($f in $Validate) {
      $d = $w.Documents.Open((Resolve-Path $f).Path, $false, $true)
      $pdf = [IO.Path]::ChangeExtension($f, 'pdf'); $d.ExportAsFixedFormat((Join-Path (Get-Location) $pdf), 17)
      $txt = $d.Content.Text -replace "[\r\a]", '|'
      $bold = 0; foreach ($wd in $d.Words) { if ($wd.Font.Bold -eq -1) { $bold++ } }
      "{0}: paragraphs={1} chars={2} boldWords={3} pdf={4}" -f $f, $d.Paragraphs.Count, $d.Characters.Count, $bold, (Test-Path $pdf)
      "  text: " + $txt.Substring(0, [Math]::Min(160, $txt.Length))
      $d.Close(0)
    }
    return
  }
  $d = $w.Documents.Add()
  $sel = $w.Selection
  $q = [char]0x201C; $q2 = [char]0x201D; $ap = [char]0x2019
  $sel.Style = $d.Styles.Item(-2); $sel.TypeText('Quarterly Report'); $sel.TypeParagraph()   # Heading 1
  $sel.Style = $d.Styles.Item(-1); $sel.TypeText('Plain intro with '); $sel.Font.Bold = 1; $sel.TypeText('bold'); $sel.Font.Bold = 0
  $sel.TypeText(', '); $sel.Font.Italic = 1; $sel.TypeText('italic'); $sel.Font.Italic = 0; $sel.TypeText(' and '); $sel.Font.Underline = 1; $sel.TypeText('underline'); $sel.Font.Underline = 0
  $sel.TypeText(" text, ${q}smart quotes${q2}, it${ap}s an em dash " + [char]0x2014 + ' and H'); $sel.Font.Subscript = 1; $sel.TypeText('2'); $sel.Font.Subscript = 0; $sel.TypeText('O, x'); $sel.Font.Superscript = 1; $sel.TypeText('2'); $sel.Font.Superscript = 0; $sel.TypeText('.'); $sel.TypeParagraph()
  $sel.ParagraphFormat.Alignment = 1; $sel.TypeText('Centred line'); $sel.TypeParagraph()
  $sel.ParagraphFormat.Alignment = 2; $sel.TypeText('Right aligned line'); $sel.TypeParagraph()
  $sel.ParagraphFormat.Alignment = 0
  $sel.Range.ListFormat.ApplyBulletDefault(); $sel.TypeText('First bullet'); $sel.TypeParagraph(); $sel.TypeText('Second bullet'); $sel.TypeParagraph()
  $sel.Range.ListFormat.RemoveNumbers(); $sel.TypeText('Symbols: ' + [char]0x00A9 + ' ' + [char]0x00AE + ' ' + [char]0x20AC + ' ' + [char]0x00E9 + ' ' + [char]0x2122 + ' ' + [char]0x2022); $sel.TypeParagraph()
  $t = $d.Tables.Add($sel.Range, 2, 3); $t.Cell(1,1).Range.Text = 'Name'; $t.Cell(1,2).Range.Text = 'Qty'; $t.Cell(1,3).Range.Text = 'Price'
  $t.Cell(2,1).Range.Text = 'Apple'; $t.Cell(2,2).Range.Text = '3'; $t.Cell(2,3).Range.Text = '1.50'
  $sel.EndKey(6) | Out-Null; $sel.TypeParagraph(); $sel.TypeText('After the table.'); $sel.TypeParagraph()
  $sel.TypeText('A hyperlink: '); $d.Hyperlinks.Add($sel.Range, 'http://example.com/', '', '', 'example link') | Out-Null; $sel.EndKey(6) | Out-Null; $sel.TypeText(' end.')
  foreach ($e in @(@('rich.doc', 0), @('rich.docx', 16), @('rich.rtf', 6))) { $d.SaveAs2((Join-Path $out $e[0]), $e[1]) }
  $d.Close(0)
  # long document, > 11 KB text
  $d = $w.Documents.Add(); $s = $d.Content
  $para = 'The quick brown fox jumps over the lazy dog while the committee reviews paragraph '
  $sb = New-Object Text.StringBuilder; for ($i = 1; $i -le 160; $i++) { [void]$sb.Append($para + $i + ", noting that it${ap}s a long document.`r") }
  $s.Text = $sb.ToString(); $d.Paragraphs(1).Range.Font.Bold = 1
  $d.SaveAs2((Join-Path $out 'long.rtf'), 6); $d.SaveAs2((Join-Path $out 'long.docx'), 16); $d.Close(0)
  Get-ChildItem $out | Select Name, Length
} finally { $w.Quit() }
