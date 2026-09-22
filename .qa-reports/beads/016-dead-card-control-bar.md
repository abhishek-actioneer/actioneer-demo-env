# BEAD-016: CardControlBar is dead code after board cleanup

**Severity:** LOW
**Category:** Code Quality / Dead Code
**Page:** N/A
**Ship-Readiness Impact:** INFO
**PR:** #48

---

## Summary

`src/components/board/card-control-bar.tsx` still defines and exports `CardControlBar` (line 215), but it has zero imports outside the file itself. The PR description states "Removed old Chart/Table tab shell, CardControlBar, custom table (-390 lines)" but the file was not actually deleted.

## Evidence

```bash
$ grep -rn "CardControlBar" src/ --include="*.tsx" | grep -v "card-control-bar.tsx"
# (no output)
```

## Fix

Delete `src/components/board/card-control-bar.tsx` entirely, or remove the export if any internal helpers are still used by other board components.
