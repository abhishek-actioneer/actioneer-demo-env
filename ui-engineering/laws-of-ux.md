# Laws of UX

Cognitive psychology principles that govern how users perceive and interact with interfaces.

## Response Time — Doherty Threshold [CRITICAL]

**Respond within 400ms** to maintain user attention and flow. Above 400ms, users disengage.

When actual speed isn't possible, fake it:
- Show skeleton screens or optimistic UI immediately
- Use progress indicators for operations over 400ms
- Prefetch data before users request it
- Animate state transitions to mask latency

```jsx
// ❌ User waits for real data
function Dashboard() {
  const data = useFetch('/api/data'); // 800ms
  if (!data) return null;
  return <Chart data={data} />;
}

// ✅ Skeleton buys perceived time
function Dashboard() {
  const data = useFetch('/api/data');
  if (!data) return <ChartSkeleton />;
  return <Chart data={data} />;
}
```

## Fitts's Law — Target Size [HIGH]

Interactive targets should be sized for easy acquisition. The further away and smaller a target, the harder it is to hit.

**Minimum 44px tap target** on touch devices. Visual size can be smaller — expand hit area with invisible padding.

```css
/* ✅ Small icon, large hit area */
.icon-button {
  width: 20px;
  height: 20px;
  position: relative;
}

.icon-button::before {
  content: '';
  position: absolute;
  inset: -12px; /* Expands hit area to 44px */
}
```

## Fitts's Law — Expand Hit Areas [HIGH]

Use invisible padding to expand hit areas beyond visual size. Never sacrifice visual density for tap target size — solve both independently.

```css
/* ✅ Pseudo-element expands hit area without visual change */
.small-close-button::before {
  content: '';
  position: absolute;
  inset: -8px;
}
```

## Hick's Law — Minimize Choices [HIGH]

Decision time increases logarithmically with the number of choices. Every option added slows the user down.

```jsx
// ❌ Too many primary actions — decision paralysis
<div>
  <Button>Save Draft</Button>
  <Button>Publish Now</Button>
  <Button>Schedule</Button>
  <Button>Preview</Button>
  <Button>Share</Button>
</div>

// ✅ One primary action, secondary actions nested
<div>
  <Button variant="primary">Publish</Button>
  <DropdownMenu trigger="More">
    <MenuItem>Save Draft</MenuItem>
    <MenuItem>Schedule</MenuItem>
    <MenuItem>Preview</MenuItem>
  </DropdownMenu>
</div>
```

## Miller's Law — Chunk Data [HIGH]

Working memory holds 5–9 items. Group related information into digestible chunks of 5–9.

```jsx
// ❌ 12 ungrouped navigation items
<nav>
  {allNavItems.map(item => <NavItem key={item.id} {...item} />)}
</nav>

// ✅ Grouped into logical sections under 9 items each
<nav>
  <NavSection label="Analytics">
    <NavItem>Overview</NavItem>
    <NavItem>Revenue</NavItem>
    <NavItem>Users</NavItem>
  </NavSection>
  <NavSection label="Settings">
    <NavItem>Account</NavItem>
    <NavItem>Integrations</NavItem>
  </NavSection>
</nav>
```

## Jakob's Law — Familiar Patterns [HIGH]

Users spend most of their time on other sites. They expect your interface to work like the ones they already know. Use familiar patterns unless you have a compelling reason not to.

- Search in the top right or top center
- Logo links to home
- Navigation at the top or left
- Destructive actions are red and require confirmation

## Progressive Disclosure [HIGH]

Show what matters now. Reveal complexity later, on demand. Don't overwhelm users with everything upfront.

```jsx
// ❌ All options visible upfront
<Form>
  <BasicFields />
  <AdvancedFields /> {/* Most users never need these */}
</Form>

// ✅ Advanced options hidden until requested
<Form>
  <BasicFields />
  <Collapsible trigger="Advanced options">
    <AdvancedFields />
  </Collapsible>
</Form>
```

## Goal Gradient — Show Progress [HIGH]

Users accelerate effort as they approach a goal. Show progress toward completion to motivate continuation.

```jsx
// ✅ Progress indicator makes goal visible
<ProgressBar value={currentStep} max={totalSteps} />
<p>{totalSteps - currentStep} steps remaining</p>
```

## Zeigarnik Effect — Show Incomplete State [MEDIUM]

People remember incomplete tasks better than completed ones. Showing incomplete state drives users to return and finish.

```jsx
// ✅ Incomplete state is visible and motivating
<ProfileCard>
  <ProgressBar value={65} />
  <p>Your profile is 65% complete</p>
  <Button>Complete profile</Button>
</ProfileCard>
```

## Peak-End Rule — End Strong [MEDIUM]

Users judge an experience primarily by its peak moment and how it ended. Ensure positive final state.

```jsx
// ✅ Clear success state at completion
function SubmitSuccess() {
  return (
    <div className="success-state">
      <CheckIcon />
      <h2>You're all set!</h2>
      <p>Your report will be ready in ~2 minutes.</p>
    </div>
  );
}
```

## Aesthetic-Usability Effect [MEDIUM]

Visually polished interfaces are perceived as more usable, even when they aren't. Users are more forgiving of rough edges in beautiful products. Visual polish is not vanity — it builds trust.

## Cognitive Load — Minimize Extraneous Load [HIGH]

Every element that isn't helping the user complete their task is adding extraneous cognitive load. Remove it.

- Eliminate decorative content that competes for attention
- Use progressive disclosure (above) to hide complexity
- Use familiar patterns (Jakob's Law) so users don't have to learn
- Prefer recognition over recall — show options, don't require users to remember them

## Pragnanz — Simplify [MEDIUM]

Users perceive complex visuals in their simplest possible form. Design toward clarity.

```jsx
// ❌ Complex nested layout that's hard to parse
// ✅ Clear visual hierarchy with obvious grouping
```

## Proximity Grouping [HIGH]

Related elements should be close together. Unrelated elements should have space between them. Proximity communicates relationship more powerfully than color or labels.

## Similarity Consistency [HIGH]

Elements that look alike should behave alike. If two buttons look the same, they should do similar things. Breaking this creates confusion.

```jsx
// ❌ Same visual style, opposite semantics
<Button>Save</Button>  {/* saves data */}
<Button>Reset</Button>  {/* destroys unsaved data */}

// ✅ Visual style signals intent
<Button variant="primary">Save</Button>
<Button variant="destructive">Reset</Button>
```

## Common Region — Boundaries [MEDIUM]

Elements within a shared boundary are perceived as a group. Use borders, backgrounds, or cards to group related content.

## Uniform Connectedness [MEDIUM]

Elements connected by a line or visual link are perceived as related. Use connectors (lines, arrows, shared borders) to show relationships between elements.

## Von Restorff — Emphasis [HIGH]

When multiple similar objects are present, the one that differs from the rest is most likely to be remembered. Use visual distinction to highlight the most important element.

```jsx
// ✅ Primary action is visually distinct
<Button variant="ghost">Cancel</Button>
<Button variant="primary">Confirm</Button>  {/* Stands out */}
```

## Serial Position — First and Last [MEDIUM]

Users best remember the first and last items in a list. Place the most important actions or information at the beginning or end.

## Tesler's Law — Move Complexity, Don't Hide It [MEDIUM]

Every application has inherent complexity. Complexity can't be eliminated — only moved. When you simplify the UI, you're moving complexity somewhere else (often into your code or the user's mental model).

## Postel's Law — Accept Messy Input [MEDIUM]

Be liberal in what you accept (user input), conservative in what you output (data stored/displayed).

```jsx
// ✅ Accept various formats, normalize output
function parseDate(input: string): Date | null {
  // Accept: "Jan 1 2025", "1/1/2025", "2025-01-01", "tomorrow"
  // Output: normalized Date object
}
```

## Pareto Principle — Prioritize Critical 20% [MEDIUM]

80% of users use 20% of features. Identify and optimize the critical 20% ruthlessly. Don't let the long tail of edge cases degrade the core experience.
