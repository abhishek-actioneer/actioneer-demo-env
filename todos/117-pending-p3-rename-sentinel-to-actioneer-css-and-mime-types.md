---
status: complete
priority: p3
issue_id: "117"
tags: [rename, refactor, branding]
dependencies: []
---

# Rename Sentinel → Actioneer in CSS class names and drag-and-drop MIME types

## Problem Statement

CSS classes and custom MIME types still use "sentinel" as a namespace. Not user-visible but should be consistent.

## Scope

### CSS class name: `.sentinel-canvas`

| File | What to change |
|------|---------------|
| `src/app/globals.css` | `.sentinel-canvas` in 5 CSS rules → `.actioneer-canvas` |
| `src/components/canvas/tldraw-canvas.tsx` | `className="sentinel-canvas"` → `className="actioneer-canvas"` |

### SVG element ID

| File | What to change |
|------|---------------|
| `src/components/canvas/shapes/dot-grid.tsx` | `id="sentinel-dot-grid"` → `id="actioneer-dot-grid"` |

### Drag-and-drop MIME types

| File | What to change |
|------|---------------|
| `src/components/sidebar.tsx` | `"application/x-sentinel-chat"` → `"application/x-actioneer-chat"` (3 occurrences) |
| `src/components/sidebar/panels.tsx` | `"application/x-sentinel-entity"` → `"application/x-actioneer-entity"` |

## Acceptance Criteria

- [ ] No CSS class, SVG id, or MIME type contains "sentinel"
- [ ] Canvas styling still works (dot grid, selection, watermark hide)
- [ ] Chat drag-and-drop between sidebar items still works
- [ ] Entity drag from panels still works
