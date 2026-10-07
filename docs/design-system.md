# Design system

Clean, calm, trustworthy fintech UI: strong contrast, generous spacing, no
gradients, minimal motion. Light and dark modes from the same semantic roles.

## Tokens (`src/theme/tokens.ts`)

| Token | Values |
| --- | --- |
| Spacing (4-pt) | `xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48` |
| Radius | `sm 6 · md 10 · lg 16 · xl 24 · pill` |
| Typography | `display 34 · title 24 · heading 18 · body 16 · bodyStrong 16 · label 14 · bodySmall 14 · caption 12 · amountLarge 34 · amount 16` (amounts use tabular figures) |
| Elevation | `none · low · medium` — subtle; borders do most of the work |
| Touch target | `48` minimum |

Raw `palette` values are only referenced by `colors.ts`.

## Semantic colors (`src/theme/colors.ts`)

`background, surface, surfaceRaised, surfaceMuted, border, borderStrong, text,
textSecondary, textMuted, textInverse, primary, primaryPressed, onPrimary,
primaryMuted, onPrimaryMuted, positive(+Muted), negative(+Muted),
warning(+Muted), focusRing, overlay, skeleton, tabBar`

- `positive` = money in, `negative` = money out / overspent, `warning` = approaching limits.
- Every text/background pair meets **WCAG AA (4.5:1)** in both modes — enforced by
  `src/theme/__tests__/contrast.test.ts`.
- Sign is never conveyed by color alone (amounts always show `+`/`−`).

## Using the theme

```tsx
const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.colors.surface, padding: t.spacing.lg, borderRadius: t.radius.lg },
}));

function Example() {
  const styles = useStyles();
  const theme = useTheme(); // scheme, colors, reduceMotion, …
}
```

Never hardcode colors, sizes or font styles in components.

Theme mode (`system | light | dark`) is a per-device setting (More → Appearance).

## Components (`src/components/ui`)

| Component | Notes |
| --- | --- |
| `Text` | Variants + tone; headings exposed as headers; scales with OS font size |
| `Button` | primary / secondary / ghost / destructive; loading = busy + disabled |
| `IconButton` | Requires `accessibilityLabel` |
| `TextField` | Persistent label, hint, error (announced), secure reveal toggle |
| `FormTextField` | React Hook Form binding; translates Zod i18n keys |
| `Card` | Surface; pressable variant is one accessible button |
| `Screen` | Safe area, scroll, keyboard avoidance, refresh, footer |
| `ListItem` | Icon, title, subtitle, trailing; radio semantics when `selected` is set |
| `Badge` | neutral / primary / positive / negative / warning |
| `ProgressBar` | Basis points in; exposes `progressbar` role with value |
| `MoneyText` | Exact, locale-formatted amounts; optional sign coloring |
| `BottomSheet` | RN Modal; focus-trapped; no slide when reduce-motion is on |
| `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` | Standard states; `ErrorState` shows translated messages only |
| `SectionHeader`, `Divider`, `Icon` | Layout helpers (Ionicons) |

Every data-driven screen renders exactly one of: content, loading/skeleton,
empty, or error — never a blank screen.

## Accessibility checklist

- Touch targets ≥ 48; `hitSlop` for small text actions.
- Every interactive element has a role and label; icon-only buttons require one.
- Dynamic Type supported; dense UI (tab labels, badges) capped at 1.4×.
- Live regions for errors and the offline banner.
- Reduced motion respected (`theme.reduceMotion`).
- Logical layout properties (`marginStart`, `paddingEnd`) for RTL.

## Navigation

Tabs: **Home · Transactions · [+] · Budgets · Reports · More**. The centre button
opens the Add sheet (native form sheet) for Expense / Income / Transfer.
