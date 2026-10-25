# Material 3 Expressive — the values Sonolith uses

Values gathered from the public Material 3 guidelines (m3.material.io) in Oct 2026. They are the source of truth for
the M3 style in Sonolith, so you shouldn't need to re-browse. dp = CSS px. Where the site only shows a value in an image, the value is the Compose/MDC default and is
marked (lib).

## Motion: springs

Two kinds: **spatial** springs move things (position, size, shape/corners) and may overshoot; **effects** springs
change color/opacity and never overshoot (damping 1). Expressive scheme = bouncier spatial springs; effects are the
same in both schemes. Damping is the damping *ratio* ζ; stiffness k with mass 1.

| Token | Expressive ζ / k | Standard ζ / k | Web curve fallback (expressive) |
| --- | --- | --- | --- |
| fast spatial | 0.6 / 800 | 0.9 / 1400 | cubic-bezier(0.42, 1.67, 0.21, 0.90) 350 ms |
| default spatial | 0.8 / 380 | 0.9 / 700 | cubic-bezier(0.38, 1.21, 0.22, 1.00) 500 ms |
| slow spatial | 0.8 / 200 | 0.9 / 300 | cubic-bezier(0.39, 1.29, 0.35, 0.98) 650 ms |
| fast effects | 1 / 3800 | same | cubic-bezier(0.31, 0.94, 0.34, 1.00) 150 ms |
| default effects | 1 / 1600 | same | cubic-bezier(0.34, 0.80, 0.34, 1.00) 200 ms |
| slow effects | 1 / 800 | same | cubic-bezier(0.34, 0.88, 0.34, 1.00) 300 ms |

Use: fast spatial for small components (button shape morph, switch handle, toggles), default spatial for medium
(panels, menus, chips), slow spatial for full-screen (Now Playing slide). Effects springs for color/opacity.
Springs are interruptible: a new target keeps the current velocity.

## Shape: corner scale

none 0 · extra-small 4 · small 8 · medium 12 · large 16 · large-increased 20 · extra-large 28 ·
extra-large-increased 32 · extra-extra-large 48 · full (pill). Nested shapes: inner = outer − padding (optical
roundness). Inner corners of grouped items (menus, connected button groups, split buttons) use small values.

Shape morph on press: round and square buttons both morph to the same *pressed* radius; toggle buttons also change
their resting shape when selected (round → square; square → round).

## Typography

Major Second scale (1.125), base 14. Baseline weights: display/headline/title-large/body 400, title-medium/small and
labels 500. **Emphasized** set (expressive): display/headline/title-large 500, title-medium/small 700, body 500,
label 700; same sizes. Use emphasized for selected items, primary actions, headlines, hero text.

| Style | size / line-height | tracking |
| --- | --- | --- |
| display-large | 57 / 64 | -0.25 |
| display-medium | 45 / 52 | 0 |
| display-small | 36 / 44 | 0 |
| headline-large | 32 / 40 | 0 |
| headline-medium | 28 / 36 | 0 |
| headline-small | 24 / 32 | 0 |
| title-large | 22 / 28 | 0 |
| title-medium | 16 / 24 | 0.15 |
| title-small | 14 / 20 | 0.1 |
| body-large | 16 / 24 | 0.5 |
| body-medium | 14 / 20 | 0.25 |
| body-small | 12 / 16 | 0.4 |
| label-large | 14 / 20 | 0.1 |
| label-medium | 12 / 16 | 0.5 |
| label-small | 11 / 16 | 0.5 |

## Color roles

primary / on-primary / primary-container / on-primary-container, same for secondary and tertiary; error roles;
surface, surface-dim/bright, **surface-container-lowest, -low, -container, -high, -highest** (dark tones ≈ 4, 10,
12, 17, 22; light ≈ 100, 96, 94, 92, 90), on-surface, on-surface-variant, outline, outline-variant,
inverse-surface / inverse-on-surface / inverse-primary, scrim, shadow.

**State layers** (overlay of the content color on the container): hover 8 %, focus 10 %, pressed 10 %, dragged
16 %. Disabled: container on-surface 10 %, content on-surface 38 %.

Sonolith derives these from its `--c-*` tokens with `color-mix` (see `src/theme/m3.ts`), so every palette works.

## Components

**Buttons** (common): heights XS 32 · S 40 · M 56 · L 96 · XL 136; horizontal padding XS 12 · S 16 · M 24 · L 48 ·
XL 64; icon XS/S 20 · M 24 · L 32 · XL 40; label XS/S label-large · M title-medium · L headline-small ·
XL headline-large. Square variant corners XS 12 · S 12 · M 16 · L 28 · XL 28; **pressed** corners XS 8 · S 8 ·
M 12 · L 16 · XL 16; round = full. Colors (default / toggle unselected / toggle selected):
- elevated: surface-container-low + primary / same / primary + on-primary
- filled: primary + on-primary / surface-container + on-surface-variant / primary + on-primary
- tonal: secondary-container + on-secondary-container / same / secondary + on-secondary
- outlined: outline-variant border + on-surface-variant / same / inverse-surface + inverse-on-surface
- text: primary (no toggle)

**Icon buttons**: same sizes (XS 32 · S 40 · M 56 · L 96 · XL 136), widths narrow/default/wide; standard (no
container, on-surface-variant; selected primary), filled, tonal, outlined like buttons; square and pressed corners
as for buttons; toggle: round unselected → square selected. Target ≥ 48.

**Button groups**: standard — gaps XS 18 · S 12 · M/L/XL 8; pressing a button widens it (≈ +15 %) and narrows the
neighbours, spring-animated. Connected — 2 px gap, outer corners full, inner corners XS 4 · S 8 · M 8 · L 16 ·
XL 20; selected item morphs to full round; neighbours don't move.

**Split button**: leading button + trailing chevron button, 2 px gap, inner corners small (4 for S); trailing
chevron rotates 180° when the menu is open and the trailing part becomes fully round.

**FAB**: 56 / corner 16 (large shape) · medium 80 / 20 · large 96 / 28; colors primary-container (default),
secondary/tertiary-container variants. **Extended FAB**: height 56 (S), 80 (M), 96 (L), label title-medium+.

**Chips** (assist / filter / input / suggestion): height 32, corner 8 (small), padding 16 (12 with icon), icon 18,
label-large. Outlined: outline-variant 1 px. Selected filter chip: secondary-container, no border, leading check.

**Sliders** (expressive): sizes by track height XS 16 · S 24 · M 40 · L 56 · XL 96; track corner XS/S 8 ·
M 12 · L 16 · XL 28; handle is a **vertical bar 4 wide**, height XS/S 44 · M 52 · L 68 · XL 108, with a **6 px gap**
to the track on each side; inner track corners 2. Active track primary, inactive secondary-container, stop
indicators 4 px dots. Value indicator: 44 high, 48 wide, inverse-surface. Handle narrows to 2 while pressed.

**Progress indicators**: track 4, active–track gap 4, stop indicator 4; **wavy** shape: amplitude 3 (container
10), wavelength 40 (determinate), amplitude ramps to 0 near 0 % / 100 % and when paused (lib). Colors primary +
secondary-container.

**Loading indicator** (new): 48 container, 38 shape; morphs through soft-burst → 9-cookie → pentagon → pill →
sunny → 4-cookie → oval while rotating; contained variant on primary-container (on-primary-container shape). Use
for short waits (< 5 s) instead of a spinner, not for page skeletons.

**Switch**: track 52 × 32, full corners; handle 16 (off) → 24 (on, or 28 while pressed); off track
surface-container-highest + outline border 2, handle outline; on track primary, handle on-primary.

**Navigation rail** (expressive): collapsed 96 wide, expanded 220–360; items: active-indicator pill 56 × 32 around
the icon (collapsed) or a full-width 56-high pill with icon + label (expanded), secondary-container, label-medium
(label-large in expanded). Top-aligned, optional FAB / menu on top.

**Top app bar**: small 64 high, title-large; search app bar has the search bar inside. **Search bar**: 56 high,
full corners, surface-container-high, leading search icon, body-large placeholder on-surface-variant.

**Menus** (expressive "vertical menus"): container surface-container-low, corner large (16), 4 px inner padding;
items 44 high, 12 padding, label-large; hovered/selected items get their own rounded state (corner 12), selected =
tertiary-container + on-tertiary-container. Vibrant variant: tertiary-container. Groups separated by a 2 px gap.

**Dialogs**: corner extra-large (28), surface-container-high, padding 24, 280–560 wide, optional icon (24,
secondary) on top centred, headline-small, body-medium on-surface-variant, text buttons right-aligned 8 apart.

**Cards**: corner medium (12); elevated (surface-container-low + shadow), filled (surface-container-highest),
outlined (outline-variant). Padding 16.

**Lists**: item 56 (one line), 72 (two), 88 (three); padding 16; leading media 56 or 40 avatar; expressive
segmented lists: items on surface-container with large outer corners and 4 px inner corners, 2 px gaps; selected
item secondary-container with full-ish corners.

**Tooltips**: plain — inverse-surface + inverse-on-surface, corner 4, 24 high, padding 8, body-small; rich —
surface-container, corner 12.
