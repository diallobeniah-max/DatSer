# DatSer Design System

DatSer uses a compact, high-contrast attendance interface that must remain readable during live service on phones, tablets, and desktops. The code source of truth is [`src/styles/design-tokens.css`](../src/styles/design-tokens.css).

## Color

| Role | Light | Dark | Usage |
| --- | --- | --- | --- |
| Primary | `#f2550a` | `#f2550a` | Primary actions and active navigation |
| Present | `#16a34a` | `#16a34a` | Confirmed present state |
| Absent | `#dc2626` | `#dc2626` | Confirmed absent state |
| Clear | `#f3f4f6` | `#525252` | Explicit neutral/clear action |
| Canvas | `#f7f3ee` | `#0b0b0c` | App background |
| Surface | `#ffffff` | `#202020` | Cards, sheets, and panels |
| Border | `#d1d5db` | `#525252` | Control and card boundaries |
| Text | `#111827` | `#f9fafb` | Primary text |
| Muted text | `#6b7280` | `#a3a3a3` | Helper and secondary text |
| Success | `#16a34a` | same | Successful persistence or sync |
| Error | `#dc2626` | same | Failed action requiring attention |
| Warning | `#d97706` | same | Queued or degraded state |
| Information | `#2563eb` | same | Neutral status information |

Never communicate attendance state by color alone; retain the Present, Absent, and Clear labels and `aria-pressed` state.

## Typography

- Family: Inter with system UI fallbacks.
- Page title: `clamp(1.5rem, 2.5vw, 2rem)`, weight 700, tight line height.
- Section title: `1.125rem`, weight 650–700.
- Member name and input text: `1rem` minimum on mobile; inputs remain at least 16px to prevent iOS zoom.
- Form labels and buttons: `0.875rem–1rem`, weight 600.
- Helper text and captions: `0.75rem–0.875rem`, body line height 1.5.

Do not scale the entire UI to create density. Use compact layouts that remove secondary information while preserving readable text.

## Spacing and controls

- Base spacing steps: 4, 8, 12, 16, 24, and 32px.
- Minimum touch target: 44px; primary mobile actions should be 48px where space permits.
- Attendance controls always appear in the order Present, Absent, Clear with equal widths.
- Inputs, buttons, and compact cards use 8–12px radii. Major cards use 16px. Mobile sheets use 24px top corners.
- Borders separate controls; shadows communicate elevation, not decoration.

## Shared components

- `AttendanceChoice`: the only Present/Absent/Clear control for Add, Edit, Complete Missing Info, and expanded member attendance. Supports selected, disabled, saving, queued, and error states.
- Keyboard-safe sheets: fixed shell, fixed header/footer, and one internally scrolling body.
- Notifications: concise status, action context, and retry when failure is recoverable.

## Responsive rules

- Mobile (<640px): anchored app header and bottom dock, central internal scrolling, bottom-sheet forms, 44–48px controls.
- Tablet (640–1023px): two-column layouts where content remains readable; keyboard-safe sheets remain internally scrollable.
- Desktop (>=1024px): centered bounded content and denser multi-column panels without mobile fixed bars.
- Dark and light modes use the same hierarchy and semantic states.
- Motion uses 120–180ms transform/opacity/color transitions. Reduced-motion collapses these to effectively instant feedback.

## Reliability language

- “Saved” means Supabase confirmed the mutation.
- “Queued” means the local offline queue safely retained the mutation for retry.
- Errors preserve form data and expose a retry path.
