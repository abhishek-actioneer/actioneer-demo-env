# Component Design

## Compound Components

Use compound components when a component has multiple related parts sharing implicit state.

```jsx
// ✅ Compound — flexible, readable
<Dialog>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Are you sure?</Dialog.Title>
    <Dialog.Close>Cancel</Dialog.Close>
  </Dialog.Content>
</Dialog>

// ❌ Prop drilling — rigid, poor DX
<Dialog trigger="Open" title="Are you sure?" closeText="Cancel" />
```

**When to use:** Multiple related elements sharing state, flexible slot ordering, optional sections.
**When NOT to use:** Simple components (1–3 props), fixed structure that never varies.

## Customization API — Goldilocks Principle

Too rigid: users fork or add hacks. Too flexible: API is overwhelming.

```jsx
// ❌ Too rigid
<Button>Click</Button>

// ❌ Too flexible — 30 props
<Button backgroundColor="#000" hoverColor="#333" borderRadius={4} ... />

// ✅ Variants + escape hatch
<Button variant="primary" size="md" className="custom-override">Click</Button>
```

**Customization layers:**
1. `variant` — predefined options (primary, secondary, destructive)
2. `size` — predefined sizes (sm, md, lg)
3. `className` — escape hatch for one-off overrides
4. `asChild` — render as different element

## Props API Conventions

### Consistent Naming [HIGH]

Same concept, same prop name across all components:

```jsx
// ✅ Consistent
<Input disabled />
<Button disabled />
<Select disabled />

// ❌ Inconsistent
<Input disabled />
<Button isDisabled />
<Select readonly />
```

### Boolean Props — Positive Names [MEDIUM]

Avoid double negatives. Use positive names:

```jsx
// ✅
<Input disabled />
<Modal open />

// ❌
<Input notEnabled />
<Modal isNotClosed />
```

### Event Handler Naming [MEDIUM]

Prefix with `on`:

```jsx
// ✅
<Input onChange={} onBlur={} />
<Dialog onOpenChange={} />

// ❌
<Input handleChange={} blurHandler={} />
```

### Boolean Prop Variants — Use variant Instead [MEDIUM]

```jsx
// ❌ Boolean soup — order matters, combinatorial explosion
<Button primary large rounded>Click</Button>

// ✅ Explicit variants
<Button variant="primary" size="lg" radius="full">Click</Button>
```

## The asChild Pattern [MEDIUM]

Allow rendering as a different element while preserving all behavior and accessibility:

```jsx
// Render as button (default)
<Button>Click</Button>

// Render as Next.js Link
<Button asChild>
  <Link href="/page">Click</Link>
</Button>
```

```jsx
import { Slot } from "@radix-ui/react-slot";

function Button({ asChild, ...props }) {
  const Comp = asChild ? Slot : "button";
  return <Comp {...props} />;
}
```

## Forward Refs [MEDIUM]

Always forward refs for components wrapping DOM elements:

```tsx
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, ...props }, ref) => (
    <button ref={ref} {...props}>{children}</button>
  )
);
```

## Spread Remaining Props [MEDIUM]

Allow arbitrary HTML attributes to flow through:

```tsx
function Button({ variant, size, className, ...props }) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// Enables:
<Button data-testid="submit" aria-label="Submit form">Submit</Button>
```

## Sensible Defaults [MEDIUM]

```tsx
function Button({
  variant = "primary",
  size = "md",
  type = "button", // Not "submit" — safer default
  ...props
}) {}
```

## Controlled vs Uncontrolled [MEDIUM]

Support both patterns:

```tsx
function Input({ value: controlledValue, defaultValue, onChange, ...props }) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  function handleChange(e) {
    if (!isControlled) setInternalValue(e.target.value);
    onChange?.(e);
  }

  return <input value={value} onChange={handleChange} {...props} />;
}
```

## Composition Over Configuration [MEDIUM]

```jsx
// ✅ Composable — flexible, readable
<Card>
  <CardHeader><CardTitle>Title</CardTitle></CardHeader>
  <CardContent>Content</CardContent>
  <CardFooter><Button>Save</Button></CardFooter>
</Card>

// ❌ Configuration object — opaque, rigid
<Card
  header={{ title: "Title" }}
  footer={{ actions: [{ label: "Save" }] }}
/>
```

## Anti-Patterns

### Prop Explosion
```jsx
// ❌
<Button leftIcon={<Icon />} rightIcon={<Arrow />} iconSpacing={8} iconSize={16}>

// ✅ Use children/composition
<Button><Icon /> Click <Arrow /></Button>
```

### Premature Abstraction
Don't create a component until you've copy-pasted it 2–3 times. Wait until patterns emerge naturally.
