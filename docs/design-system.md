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

## Phase 1 additions

| Component | Notes |
| --- | --- |
| `OptionPicker` | Field + bottom sheet; searchable; radio semantics; locked state with explanation |
| `ChoiceChips` | Single-select chips (radiogroup), wraps for Dynamic Type |
| `SwitchRow` | Whole row is one accessible switch |
| `ToastHost` / `showToast` | Success feedback, announced to screen readers; slide/fade only without reduce-motion |
| `TextField` | Added `prefix` (currency symbol), `trailing` (sign toggle), `footer` (live preview) |
| `AccountIcon`, `AccountRow`, `TotalBalanceCard`, `AccountForm` | Account feature components |

Account accent colors (`ACCOUNT_COLORS`) are used behind white glyphs
(`colors.onAccent`); each passes 4.5:1 (tested). Color is never the only cue —
selected swatches show a check mark and have names for screen readers.

Motion: onboarding uses `slide_from_right` transitions and toasts animate;
both become instant when the OS reduce-motion setting is on.

## Phase 2 additions

| Component | Notes |
| --- | --- |
| `OptionPicker` | Per-option `disabled` (e.g. archived accounts stay visible but unselectable) |
| `MultiChoiceChips` | Multi-select chips with checkbox semantics (filters) |
| `CategoryIcon`, `CategoryPickerField`, `CategoryForm` | Category glyph on accent color; searchable picker grouped by parent with frequently-used first |
| `TransactionRow` | Memoised list row; one accessible button announcing merchant, category, account and signed amount; transfers read "A to B" |
| `TransactionForm`, `TransferForm` | RHF + Zod; repository errors land on the matching field |
| `SplitEditor` | Total / allocated / remaining in exact minor units; "fill remaining" per line |
| `DateTimeField`, `AccountPickerField`, `TagInput`, `ReceiptField`, `RefundLinkField` | Form fields used by the transaction forms |
| `CashFlowCard`, `TopCategoriesCard` | Home dashboard cards; say when base totals are incomplete (missing rates) |

## Phase 3 additions

| Component | Notes |
| --- | --- |
| `BudgetCard` | Spent of available, progress bar coloured by status *and* a written status badge, remaining/over, incomplete-rate notice |
| `BillRow` | Due label in local days ("Due in 3 days", "Overdue by 2 days"), "≈" for variable amounts, autopay badge |
| `SubscriptionSummaryCard` | Monthly/yearly cost; approximate values marked "≈" and explained |
| `GoalCard` | Saved of target; progress above 100% shown as text (bar is full) |
| `BudgetForm`, `BillForm`, `PayBillForm`, `GoalForm`, `ContributionForm` | RHF + Zod; repository errors mapped to fields; locked fields explained |
| `HomeBudgets`, `HomeUpcomingBills`, `HomeGoals` | Compact Home sections with one-line empty states |
| `CategoryPickerField`, `DateTimeField` | Gained `disabled`; `DateTimeField` gained `label` (date-only use) |

The Budgets tab is the planning hub: chips switch between Budgets, Bills,
Subscriptions and Goals (deep-linkable with `/budgets?section=bills`).
