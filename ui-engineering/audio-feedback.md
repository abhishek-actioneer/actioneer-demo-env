# Audio Feedback

Sound feedback in UI. Apply conservatively — most product UIs don't need sound.

## When to Use Sound

**Use sound for:**
- Confirmations of irreversible or important actions (send, delete, payment)
- Error and warning states that need immediate attention
- Completion of long-running background operations

**Never use sound for:**
- Decorative or ambient purposes [MEDIUM]
- High-frequency interactions — hover, scroll, every click [HIGH]
- Standard navigation or UI state changes

```jsx
// ❌ Decorative — plays on every mouse move
document.addEventListener('mousemove', playSound);

// ❌ High-frequency — plays on every keystroke
input.addEventListener('keydown', playSound);

// ✅ Confirmation of important action
async function sendMessage() {
  await api.send(message);
  playConfirmationSound(); // Plays once, on completion
}
```

## Sound Must Not Punish [MEDIUM]

Errors should produce informative sounds, not punishing ones. A harsh buzz or alarm for a validation error creates anxiety. Use subtle, neutral tones.

## Accessibility Requirements

### Toggle Setting [HIGH]

Always provide a setting to disable sounds completely. Sound is often disruptive in open-plan offices or for users with sensory sensitivities:

```jsx
const { soundEnabled } = useSettings();

function playSound(sound: AudioBuffer) {
  if (!soundEnabled) return;
  // Play sound
}
```

### Volume Control [MEDIUM]

Provide independent volume control for UI sounds, separate from system volume:

```jsx
const { soundVolume } = useSettings(); // 0.0 to 1.0
gainNode.gain.value = soundVolume;
```

### Respect prefers-reduced-motion for Sound [HIGH]

Users who prefer reduced motion often also prefer reduced audio stimulation. Check and respect:

```js
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersReduced) return; // Skip sound
```

### Visual Equivalent [HIGH]

Every sound must have a visual equivalent. Never communicate information through sound alone:

```jsx
// ❌ Sound-only notification — inaccessible
playNotificationSound();

// ✅ Sound + visual
playNotificationSound();
showToast('Message sent'); // Visual equivalent
```

## Weight and Duration

### Match Sound Weight to Action [MEDIUM]

Heavier, more consequential actions warrant more prominent sounds. Light clicks for minor actions, richer sounds for major ones:

| Action | Sound Weight |
|--------|-------------|
| Toggle switch | Subtle click (5–10ms) |
| Save document | Medium tone (50–100ms) |
| Send message | Distinct ping (100–200ms) |
| Destructive action confirmed | Clear, slightly somber (200–400ms) |

### Duration Matches Action Duration [MEDIUM]

Sound duration should approximate the action's perceived duration. A sound that plays long after an instant action feels wrong; a sound that cuts off before a visible operation completes feels broken.

## Sound Synthesis (Web Audio API)

For synthesized sounds (no audio files), use the Web Audio API:

### Reuse Single AudioContext [HIGH]

Create one `AudioContext` per application and reuse it. Each context is expensive:

```js
// ❌ New context per sound
function playClick() {
  const ctx = new AudioContext();
  // ...
}

// ✅ Shared context
const audioCtx = new AudioContext();

function playClick() {
  const oscillator = audioCtx.createOscillator();
  // ...
}
```

### Resume Suspended Context [HIGH]

Browsers suspend `AudioContext` until user interaction. Always resume before playing:

```js
async function playSound() {
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  // Now safe to play
}
```

### Exponential Decay [HIGH]

Use exponential ramps for natural-sounding sound decay — linear ramps sound mechanical:

```js
const gainNode = audioCtx.createGain();
gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
// ✅ Exponential — sounds natural
gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

// ❌ Linear — sounds robotic
gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
```

### No Zero Target for Exponential Ramps [HIGH]

`exponentialRampToValueAtTime` cannot ramp to zero — it causes errors. Use a very small value instead:

```js
// ❌ Error: cannot ramp to 0 exponentially
gainNode.gain.exponentialRampToValueAtTime(0, time);

// ✅ Ramp to near-zero
gainNode.gain.exponentialRampToValueAtTime(0.001, time);
```

### Set Initial Value Before Ramp [MEDIUM]

Always call `setValueAtTime` before any ramp to establish the starting value:

```js
// ❌ Missing initial value — unpredictable start
gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

// ✅ Explicit start value
gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
```

### Gain Under 1.0 [MEDIUM]

Keep gain values under 1.0 to prevent clipping:

```js
gainNode.gain.value = 0.3; // ✅ Safe
gainNode.gain.value = 1.5; // ❌ Will clip
```

### Clean Up Nodes After Playback [MEDIUM]

Disconnect audio nodes after playback to free memory:

```js
oscillator.onended = () => {
  oscillator.disconnect();
  gainNode.disconnect();
};
```

## Preload Audio Files [MEDIUM]

Preload audio files to prevent latency on first play:

```js
async function preloadSound(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer);
}

// Preload on app init
const sounds = {
  confirm: await preloadSound('/sounds/confirm.mp3'),
  error:   await preloadSound('/sounds/error.mp3'),
};
```

## Reset currentTime Before Replay [MEDIUM]

For `<audio>` elements, reset `currentTime` before replaying to handle rapid repeated triggers:

```js
function play(audioElement: HTMLAudioElement) {
  audioElement.currentTime = 0;
  audioElement.play();
}
```
