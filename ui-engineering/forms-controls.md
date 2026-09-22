# Forms & Controls

## Inputs

### Labels [HIGH]

Clicking a label should focus the input. Always associate labels with inputs:

```html
<!-- Explicit association -->
<label for="email">Email</label>
<input id="email" type="email" />

<!-- Implicit wrap -->
<label>
  Email
  <input type="email" />
</label>
```

### Input Types [HIGH]

Use appropriate `type` attributes — they trigger the correct mobile keyboard and enable browser validation:

```html
<input type="email" />
<input type="password" />
<input type="tel" />
<input type="url" />
<input type="number" />
<input type="search" />
```

### Font Size — iOS Zoom Prevention [HIGH]

Inputs with font-size below 16px cause iOS Safari to zoom in on focus. Always use 16px minimum:

```css
input, textarea, select {
  font-size: 16px; /* minimum — never smaller */
}
```

### Autofocus [MEDIUM]

Autofocus when a modal opens if an input exists. But never autofocus on touch devices — it opens the keyboard unexpectedly.

```jsx
const isTouchDevice = 'ontouchstart' in window;
<input autoFocus={!isTouchDevice} />
```

### Input Decorations [MEDIUM]

Prefix/suffix icons should be absolutely positioned over the input, not placed as siblings. They should trigger focus when clicked.

```css
.input-wrapper { position: relative; }

.input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}

.input-field { padding-left: 40px; }
```

For clickable suffix icons (clear button, etc.):

```jsx
<button onClick={() => inputRef.current?.focus()}>
  <ClearIcon />
</button>
```

### Spellcheck & Autocomplete [MEDIUM]

Disable for most inputs to avoid distracting UI noise:

```html
<input type="text" spellcheck="false" autocomplete="off" />
```

For password managers, disable 1Password specifically when not wanted:

```html
<input data-lpignore="true" data-1p-ignore />
```

## Forms

### Form Wrapper [HIGH]

Inputs must be wrapped in `<form>` to enable Enter-to-submit:

```html
<form onSubmit={handleSubmit}>
  <input type="text" />
  <button type="submit">Submit</button>
</form>
```

### Keyboard Submission [HIGH]

Support `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows) for textareas:

```jsx
function handleKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    handleSubmit();
  }
}
```

### Prefilling Forms [MEDIUM]

Use logged-in user data to prefill when possible. When linking to a form from context, prefill based on that context. Reduces friction significantly.

## Buttons

### Semantic Elements [HIGH]

Buttons must always be `<button>`. Never attach click handlers to divs or spans:

```jsx
// ❌
<div onClick={handleClick}>Click me</div>

// ✅
<button onClick={handleClick}>Click me</button>
```

### Default Type [MEDIUM]

Default `type="button"` — not `type="submit"`. Accidental form submission is hard to debug.

```jsx
function Button({ type = "button", ...props }) {
  return <button type={type} {...props} />;
}
```

### Disable After Submission [HIGH]

Prevent duplicate network requests:

```jsx
const [isSubmitting, setIsSubmitting] = useState(false);

<button
  disabled={isSubmitting}
  onClick={async () => {
    setIsSubmitting(true);
    await submitForm();
    setIsSubmitting(false);
  }}
>
  {isSubmitting ? 'Submitting…' : 'Submit'}
</button>
```

### Button Shortcuts [MEDIUM]

Show keyboard shortcut in tooltip when a button action has one:

```jsx
<Tooltip content="Save (Cmd+S)">
  <button onClick={save}>Save</button>
</Tooltip>
```

### Active State [HIGH]

```css
.button:active {
  transform: scale(0.97);
}
```

## Checkboxes & Controls

### No Dead Zones [MEDIUM]

The space between label and checkbox should be clickable. Wrap everything in a label:

```html
<label class="checkbox-row">
  <input type="checkbox" />
  <span>Remember me</span>
</label>
```

```css
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
```

## Destructive Actions [HIGH]

Always require confirmation for destructive actions. Use a modal, not `window.confirm()`:

```jsx
function handleDelete() {
  openConfirmModal({
    title: 'Delete this item?',
    description: 'This cannot be undone.',
    onConfirm: deleteItem,
    confirmLabel: 'Delete',
    variant: 'destructive',
  });
}
```

## Error Handling [HIGH]

Colocate error messages — show them close to the field that caused them, not at the top of the form:

```jsx
<div className="field">
  <label>Email</label>
  <input type="email" aria-invalid={!!error} aria-describedby="email-error" />
  {error && <span id="email-error" className="error">{error}</span>}
</div>
```
