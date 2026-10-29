[CmdletBinding()]
param(
    [switch]$Delete
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$scratchRoot = Join-Path $workspaceRoot 'application/.scratch'
$targetNames = @(
    'issue34-test-web', 'issue35-test-web', 'issue36-test-web', 'issue45-test-web',
    'issue38-tests', 'issue45-tests', 'issue46-tests', 'issue57-tests'
)

function Assert-NotLink {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to follow a link or junction: $Path"
    }
}

function Get-NormalizedSource {
    param([string]$Path, [switch]$MovedCopy)
    $content = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
    if ($MovedCopy) {
        $content = $content.Replace('../../tests/', '../')
    }
    return $content
}

Assert-NotLink $workspaceRoot
Assert-NotLink (Join-Path $workspaceRoot 'application')
Assert-NotLink $scratchRoot
$validatedTargets = @()
$totalFiles = 0
$totalBytes = 0

# Validate every target before deleting anything. No wildcard deletion.
foreach ($name in $targetNames) {
    $target = [IO.Path]::GetFullPath((Join-Path $scratchRoot $name))
    if (-not $target.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target is outside the approved scratch directory: $target"
    }
    if (-not (Test-Path -LiteralPath $target)) {
        Write-Host "Already absent: $target"
        continue
    }
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
        throw "Expected a directory: $target"
    }
    Assert-NotLink $target
    $pendingDirectories = [Collections.Generic.Queue[string]]::new()
    $pendingDirectories.Enqueue($target)
    $files = @()
    while ($pendingDirectories.Count -gt 0) {
        $directory = $pendingDirectories.Dequeue()
        foreach ($entry in (Get-ChildItem -LiteralPath $directory -Force)) {
            Assert-NotLink $entry.FullName
            if ($entry.PSIsContainer) {
                $pendingDirectories.Enqueue($entry.FullName)
            } else {
                $files += $entry
            }
        }
    }

    foreach ($file in $files) {
        if ($name.EndsWith('-test-web')) {
            if ($file.Extension -notin @('.html', '.css', '.js', '.map')) {
                throw "Unexpected file in a build directory; retained: $($file.FullName)"
            }
        } else {
            $relativePath = $file.FullName.Substring($target.Length + 1)
            $retainedRoot = Join-Path $workspaceRoot "application/tests/$name"
            $retainedFile = Join-Path $retainedRoot $relativePath
            if (-not (Test-Path -LiteralPath $retainedFile -PathType Leaf)) {
                throw "No retained source exists; duplicate directory retained: $retainedFile"
            }
            $ancestor = Get-Item -LiteralPath $retainedFile -Force
            while ($ancestor.FullName -ne $workspaceRoot) {
                Assert-NotLink $ancestor.FullName
                $ancestor = Get-Item -LiteralPath (Split-Path -Parent $ancestor.FullName) -Force
            }
            $copyText = Get-NormalizedSource -Path $file.FullName -MovedCopy
            $retainedText = Get-NormalizedSource -Path $retainedFile
            if ($copyText -cne $retainedText) {
                throw "Source differs beyond the known import-path adjustment; retained: $($file.FullName)"
            }
        }
    }

    $size = ($files | Measure-Object Length -Sum).Sum
    $totalFiles += $files.Count
    $totalBytes += $size
    $validatedTargets += $target
    Write-Host ("Validated: {0} ({1} files, {2:N2} MiB)" -f $target, $files.Count, ($size / 1MB))
}

Write-Host ("Total: {0} directories, {1} files, {2:N2} MiB" -f $validatedTargets.Count, $totalFiles, ($totalBytes / 1MB))
if (-not $Delete) {
    Write-Host 'Preview only. Run again with -Delete to remove exactly these validated directories.'
    return
}

foreach ($target in $validatedTargets) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Host "Deleted: $target"
}

foreach ($target in $validatedTargets) {
    if (Test-Path -LiteralPath $target) {
        throw "Directory still exists after deletion: $target"
    }
}
Write-Host 'Cleanup completed. Retained source directories and evidence were not deleted.'
