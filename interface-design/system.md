# Interface Design System — Baby Sentinel / Connectors

## Colors

| Role | Value |
|------|-------|
| Connector tile fill | `#F9F7F3` |
| Connector tile border | `#e4e1db` |
| Accordion header fill | `#F9F7F3` |
| Accordion header border | `#F4EFE5` |
| Accordion header hover fill | `#F4F1EA` |
| Dividing lines inside accordion | `#F0EDE8` |
| Search clear button hover | `#F4F1EA` |
| Status / meta text | `#6d6863` |

---

## Interaction Effects

### Primary tap — action buttons, connector tiles
Scale `0.95` on press only. No hover transform.
```tsx
style={{ transition: "transform 0.2s ease" }}
onPointerDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
onPointerUp={e => (e.currentTarget.style.transform = "scale(1)")}
onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
```

### Subtle hover + press — rows, chips, dropdowns, search box
`0.99` on hover, `0.97` on press, returns to `0.99` on release, `1` on leave.
```tsx
style={{ transition: "transform 0.2s ease" }}
onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
```
Applied to: dataset rows, filter chips, dropdown triggers, search box wrapper, table row headers, Add more button.

### Accordion header hover
Background swap only, no transform.
```tsx
style={{ background: "#F9F7F3", border: "1px solid #F4EFE5" }}
onMouseEnter={e => (e.currentTarget.style.background = "#F4F1EA")}
onMouseLeave={e => (e.currentTarget.style.background = "#F9F7F3")}
```

---

## Refresh State

Content fades to `opacity: 0.4` for the duration of the refresh, restores smoothly on complete.
```tsx
style={{ opacity: refreshing ? 0.4 : 1, transition: "opacity 0.3s ease" }}
```
Applied to the entire connections list and both list/schema views on the dataset page.

---

## Search Input

- `type="text"` (not `type="search"`) — removes native browser clear button
- Right padding: `pr-9` to accommodate custom clear button
- Custom clear button: visible only when input has value
- Clear button tap area: `32×32px` (`w-8 h-8`), `rounded-lg` (8px), positioned `right-0.5`
- Clear button hover: `#F4F1EA` background
- Icon size: `w-3 h-3` (`X` from lucide-react), color `#6d6863`

```tsx
<div
  className="relative"
  style={{ transition: "transform 0.2s ease" }}
  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
>
  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
  <input type="text" className="... pl-8 pr-9 py-2 ..." />
  {value && (
    <button
      className="absolute right-0.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
      style={{ color: "#6d6863" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#F4F1EA")}
      onMouseLeave={e => (e.currentTarget.style.background = "")}
    >
      <X className="w-3 h-3" />
    </button>
  )}
</div>
```

---

## Components

### Filter Button (dataset page — Dataset / Version / Table Type dropdowns)
Label above, chevron rotates on open. `rounded-lg`, `text-[13px] font-medium`.
```tsx
<div className="flex flex-col gap-1.5 relative">
  <span className="text-xs text-muted-foreground">Dataset</span>
  <button
    className="flex items-center gap-2 px-3.5 py-2 border border-border rounded-lg bg-background hover:bg-muted/20 transition-colors"
    style={{ transition: "transform 0.2s ease" }}
    onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
    onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
    onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
    onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
  >
    <span className="text-[13px] font-medium">{label}</span>
    <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
  </button>
</div>
```

### Selection Chip (add-connectors page — All connectors / Warehouse / MMP / Ad Networks etc.)
Outlined border style. Active state: `bg-muted text-foreground`. Shows checkmark when active. `rounded-xl`, `px-3.5 py-1.5`, `leading-4`.
```tsx
<button
  className={`flex items-center gap-1.5 px-3.5 py-1.5 leading-4 text-sm font-medium rounded-xl border transition-colors whitespace-nowrap ${
    isActive
      ? "bg-muted text-foreground border-border"
      : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted/50"
  }`}
  style={{ transition: "transform 0.2s ease, color 0.15s, background 0.15s" }}
  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
>
  {isActive && <Check className="w-3 h-3 shrink-0" />}
  {label}
</button>
```

---

## Typography

- **Table headings / column headers**: sentence case — never all-caps, no `uppercase` or `tracking-wider`
- **Table names**: `font-medium` (not semibold)
- **Meta / secondary text**: `text-xs text-muted-foreground`
- **Status / timestamp text**: color `#6d6863`
- **Dropdown subheaders**: sentence case

---

## Spacing & Structure

- Accordion list gap: `space-y-4`
- Accordion header padding: `p-2`
- Dataset rows: `h-10 px-3`
- Connector tile padding: `9px` all sides, gap `6px`

---

## Modal

Entry animation: scale `0.9 → 1`, duration `0.2s`, ease `[0.23, 1, 0.32, 1]`.
Overlay: `backdrop-blur-[2px]` (not `backdrop-blur-md`).
```tsx
initial={{ scale: 0.9, opacity: 0 }}
animate={{ scale: 1, opacity: 1 }}
transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
```
