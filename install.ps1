#!/usr/bin/env pwsh
# Idempotent setup for a new machine (Windows port of install.sh).
# Links skills into ~/.claude/skills/ (and ~/.cursor/skills-cursor/ if Cursor is present).
#
# Handles two layouts under skills/:
#   skills/<name>/SKILL.md              -> linked as <name>
#   skills/<repo>/<name>/SKILL.md       -> each sub-skill linked individually
#                                          (for multi-skill upstream repos like greptile)
#
# Link strategy: tries a directory SymbolicLink first (needs Developer Mode or an
# elevated shell). If that fails for lack of privilege, falls back to a Junction,
# which needs no elevation and behaves the same for local directories.
#
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File install.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$KitDir           = $PSScriptRoot
$ClaudeSkillsDir  = Join-Path $HOME '.claude\skills'
$CursorSkillsDir  = Join-Path $HOME '.cursor\skills-cursor'

New-Item -ItemType Directory -Force -Path $ClaudeSkillsDir | Out-Null

# Build target list. Each entry: @{ Name = <skill_name>; Path = <absolute_skill_path> }
$targets = @()
$skillsRoot = Join-Path $KitDir 'skills'
foreach ($entry in Get-ChildItem -Path $skillsRoot -Directory) {
    $name = $entry.Name

    # cmux-swarm ships as a standalone plugin (plugins/cmux-swarm), installed via
    #   /plugin marketplace add <this-repo>  ->  /plugin install cmux-swarm@agentic-kit
    # Do NOT also link it as loose skills, or create-swarm/code-check/visual-check
    # would be registered twice. Skip it here regardless of where it lives.
    if ($name -eq 'cmux-swarm') {
        Write-Host "skip ${name}: provided by the cmux-swarm plugin (see plugins/cmux-swarm)"
        continue
    }

    if (Test-Path -LiteralPath (Join-Path $entry.FullName 'SKILL.md') -PathType Leaf) {
        $targets += @{ Name = $name; Path = $entry.FullName }
        continue
    }

    # Multi-skill repo: look one level deeper for SKILL.md files.
    $foundSubskill = $false
    foreach ($sub in Get-ChildItem -Path $entry.FullName -Directory) {
        if (Test-Path -LiteralPath (Join-Path $sub.FullName 'SKILL.md') -PathType Leaf) {
            $targets += @{ Name = $sub.Name; Path = $sub.FullName }
            $foundSubskill = $true
        }
    }

    if (-not $foundSubskill) {
        Write-Host "warn ${name}: no SKILL.md at top level or one level down - skipping"
    }
}

function New-SkillLink {
    param(
        [string]$DestDir,
        [string]$SkillName,
        [string]$SkillPath
    )

    $target = Join-Path $DestDir $SkillName
    $label  = $DestDir.Replace($HOME, '~')

    $existing = Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    if ($existing) {
        $linkTarget = $existing.Target  # null for a real (non-link) file/dir
        if ($linkTarget) {
            # Normalize for comparison; junctions/symlinks may report a trailing slash.
            $current = ($linkTarget | Select-Object -First 1).TrimEnd('\')
            if ($current -eq $SkillPath.TrimEnd('\')) {
                Write-Host "ok   $SkillName -> $label (already linked)"
                return
            }
            Write-Host "warn ${SkillName}: $label link points elsewhere ($current) - skipping"
            return
        }
        Write-Host "warn ${SkillName}: real file/dir exists at $target - skipping (move it manually)"
        return
    }

    try {
        New-Item -ItemType SymbolicLink -Path $target -Target $SkillPath -ErrorAction Stop | Out-Null
        Write-Host "link $SkillName -> $label (symlink)"
    }
    catch {
        # Most commonly: not elevated and Developer Mode off. Junctions need neither.
        try {
            New-Item -ItemType Junction -Path $target -Target $SkillPath -ErrorAction Stop | Out-Null
            Write-Host "link $SkillName -> $label (junction)"
        }
        catch {
            Write-Host "warn ${SkillName}: could not create symlink or junction - $($_.Exception.Message)"
        }
    }
}

foreach ($row in $targets) {
    New-SkillLink -DestDir $ClaudeSkillsDir -SkillName $row.Name -SkillPath $row.Path
    if (Test-Path -LiteralPath $CursorSkillsDir -PathType Container) {
        New-SkillLink -DestDir $CursorSkillsDir -SkillName $row.Name -SkillPath $row.Path
    }
}

Write-Host ''
Write-Host "Done. Skills available in $ClaudeSkillsDir."
if (Test-Path -LiteralPath $CursorSkillsDir -PathType Container) {
    Write-Host "Also linked into $CursorSkillsDir."
}
Write-Host "Conventions: $(Join-Path $KitDir 'conventions')  (see todo.md for what to capture next)"
