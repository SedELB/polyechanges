# Convertit un classeur .xls en texte Unicode tabulé (UTF-16, une rangée par ligne) avec Excel (automatisation COM).
# Le classeur est ouvert en lecture seule, macros désactivées ; son contenu n'est jamais exécuté.
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Path).Path
$target = [System.IO.Path]::ChangeExtension($source, '.txt')
if ($target -eq $source) { throw "Le fichier doit avoir une autre extension que .txt : $source" }

$excel = $null
$book = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AutomationSecurity = 3   # msoAutomationSecurityForceDisable : aucune macro
  $book = $excel.Workbooks.Open($source, 0, $true)   # sans mise à jour des liens, lecture seule
  $sheet = $book.Worksheets.Item(1)
  # Un saut de ligne dans une cellule casserait « une rangée par ligne » : remplacé par une espace, en mémoire seulement.
  $null = $sheet.UsedRange.Replace([string][char]10, ' ', 2)
  $null = $sheet.UsedRange.Replace([string][char]13, ' ', 2)
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  $sheet.SaveAs($target, 42)   # xlUnicodeText
  Write-Output "OK $target"
}
finally {
  if ($book) { $book.Close($false); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
  if ($excel) { $excel.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
