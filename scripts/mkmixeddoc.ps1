# Makes docs\samples\word\mixed-fonts.docx with Word COM: paragraphs that mix fonts (dominant font by characters differs per paragraph).
$w = New-Object -ComObject Word.Application
$w.Visible = $false
try {
  $d = $w.Documents.Add()
  $d.Content.Text = "Arial dominant with a little Courier New in it.`rTimes New Roman dominant, then Arial for a few words.`rOnly Courier New here.`rPlain Arial paragraph."
  function Set-Font($para, $name) { $para.Range.Font.Name = $name }
  Set-Font $d.Paragraphs(1) 'Arial'
  Set-Font $d.Paragraphs(2) 'Times New Roman'
  Set-Font $d.Paragraphs(3) 'Courier New'
  Set-Font $d.Paragraphs(4) 'Arial'
  $f = $d.Paragraphs(1).Range.Find; if ($f.Execute('Courier New')) { $f.Parent.Font.Name = 'Courier New' }
  $f = $d.Paragraphs(2).Range.Find; if ($f.Execute('Arial for a few')) { $f.Parent.Font.Name = 'Arial' }
  $out = Join-Path $PSScriptRoot '..\docs\samples\word'
  $d.SaveAs2((Join-Path (Resolve-Path $out) 'mixed-fonts.docx'), 16)
  $d.Close(0)
} finally { $w.Quit() }
