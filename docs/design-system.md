# Design system

Clean, calm, trustworthy fintech UI. It uses:
- a violet brand colour (`#5B45E0`) on a soft lavender canvas (`#F6F5FB`);
- white cards with 20 pt continuous corners;
- two typefaces;
- a small type scale;
- quiet layered shadows, and no gradients.

There is a single light theme (no dark mode). Native views are locked to light
(`userInterfaceStyle: 'light'`).

**Sources.** The rules below adopt the parts of two external skill sets that fit
a React Native finance app:
- **Vercel `react-native-skills`:** fonts embedded at build time with the
  `expo-font` config plugin, CSS `boxShadow`, `borderCurve: 'continuous'`,
  `gap` for spacing, a deliberately small set of font sizes, and `Pressable`
  everywhere.
- **bencium `controlled-ux-designer`, `design-audit` and `typography`:**
  - a type scale of about ×1.25 on a 4-pt grid;
  - four or five neutrals plus one to three accents;
  - tighter tracking for large type and letter-spaced all-caps;
  - curly apostrophes;
  - one primary action per screen.

We did not adopt native tabs, because they can't host the raised + button.
Reanimated gesture rules and web-only rules don't apply to this app.

## Typography

| Role | Typeface | Weights |
| --- | --- | --- |
| Display, titles, section headings, hero amount | Plus Jakarta Sans | 600 · 700 · 800 |
| UI text, labels, numbers | Inter (tabular figures for amounts) | 400 · 500 · 600 |

- **Files:** in `assets/fonts` (OFL licences alongside). They are embedded
  with the `expo-font` config plugin in `app.config.ts`, so there's no async
  loading at launch.
- **Weights:** on Android each typeface is one family (`Inter`,
  `PlusJakartaSans`), so `fontWeight` picks the right file.
- **Scale:** six sizes, `12 · 14 · 16 · 20 · 28 · 36`.

| Variant | Size / line | Notes |
| --- | --- | --- |
| `display`, `amountLarge` | 36 / 42 | Jakarta 800, −0.9 tracking |
| `title` | 28 / 34 | Jakarta 700 (tab headers) |
| `heading` | 20 / 26 | Jakarta 700 (cards, sheets, empty states) |
| `body`, `bodyStrong`, `amount` | 16 / 24 | Inter 400 / 600 |
| `label`, `bodySmall` | 14 / 20 | Inter 600 / 400 |
| `caption` | 12 / 16 | Inter 500, +0.2 |
| `overline` | 12 / 16 | Inter 600, all caps, +0.9: section headers, day headers, status tags |

`src/theme/__tests__/typography.test.ts` enforces:
- only the two typefaces;
- nothing below 12 pt;
- line heights on the 2-pt grid;
- exactly these six sizes;
- letter-spaced capitals;
- tabular figures for amounts.

## Tokens (`src/theme/tokens.ts`)

| Token | Values |
| --- | --- |
| Spacing (4-pt) | `xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · gutter 20 · xl 24 · section 28 · xxl 32 · xxxl 48` |
| Radius | `sm 8` (tags) `· md 12` (inputs, keys, icon tiles) `· lg 20` (cards) `· xl 28` (sheets) `· pill` (buttons, chips) |
| Elevation (`boxShadow`) | `low` (cards) · `medium` (hero, dial centre) · `bar` (bottom bar, upward) · `brand` (raised + glow) |
| Touch target | 48 minimum (chips are 40 with a 4 pt hit slop) |

Layout rhythm:
- 20 pt screen margins (`gutter`);
- 24 pt between blocks on a screen;
- 12 pt from a section header to its content;
- 16 pt card padding;
- list rows at least 64 pt, with 40 pt rounded-square icons.

## Semantic colors (`src/theme/colors.ts`)

- **Neutrals** (cool, slightly violet):
  - background `#F6F5FB`, surface `#FFFFFF`, surfaceMuted `#F1EFF8`;
  - border `#E8E5F1`, borderStrong `#D4D0E3`;
  - text `#17152B`, textSecondary `#57546D`, textMuted `#706D86`.
- **Accents:**
  - primary `#5B45E0` (pressed `#4A34C7`, tint `#EEEBFF`);
  - positive `#13774F`, negative `#C02A35`, warning `#8A5A00`, each with a
    tint.
- **Charts:**
  - income is violet `#5B45E0` and spending is coral `#E0773A`;
  - both are at least 3:1 on white;
  - under simulated deuteranopia, protanopia and tritanopia the pair stays at
    least 31 ΔE apart (OKLab ×100).

`positive` means money in; `negative` means money out or overspent; `warning`
means approaching a limit. Every text/background pair meets **WCAG AA
(4.5:1)**, including muted text on the canvas, and
`src/theme/__tests__/contrast.test.ts` enforces it. Sign is never shown by
colour alone: amounts always show `+` or `−`.

## Tags and badges

- **`TagChip`:** a user's tags, written `#name` with a muted hash.
  - Applied tags are *solid* (tint, with a × to remove them).
  - Suggestions are *outline* with `+`.
  - 32 pt tall with an 8 pt hit slop.
  - Used on the entry form, transaction detail and recurring rules.
- **`TagInput`:** a token field. Chips sit inside the box with the text
  input. Enter or a comma adds a tag, blur adds what was typed, and up to 8
  existing tags are offered below.
- **`Badge`:** a status, as an 8 pt-radius tinted tag in neutral, primary,
  positive, negative or warning tone.
  - Short statuses use `caps` (overline): REPEATS, REFUND.
  - Longer text stays in sentence case.
  - It can take an icon.

## Using the theme

```tsx
const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.colors.surface, padding: t.spacing.lg, borderRadius: t.radius.lg },
}));

function Example() {
  const styles = useStyles();
  const theme = useTheme(); // colors, spacing, reduceMotion, …
}
```

Never hardcode colors, sizes or font styles in components.

## Bottom navigation (`features/navigation/AppTabBar.tsx`)

White `tabBar` surface with a soft upward shadow (no hard line). A short brand bar on the top edge marks the active tab. Every tab shows its label
(caption, max font scale 1.4); the active tab's filled icon and label are
`primary`, inactive ones `textMuted`. Each tab is a full-height (≥ 64 pt) `tab`
with selected state. The centre **+** is a raised 58 pt `primary` circle that
opens a new expense (it is never a tab). The bar sits in the layout (content
never scrolls under it), pads for the gesture/navigation bar, and is hidden
while the keyboard is open.

Tabs: Home · Activity · + · Plan · Insights. Every tab uses the same large in-page header (`TabHeader`: 28 pt title and the Settings gear); Plan’s sections are one scrollable row of chips. Settings (accounts,
categories, data, preferences, sync, account) is not a tab: a labelled gear
button (48 pt) at the top right of every tab header opens `/settings` as a
regular stack screen with a back button.

## Key flows

- **First launch:** intro slides, then *Get started* (no account) or *I
  already have an account*.
- **First-run tips** (`features/tips/FirstRunTips.tsx`): three one-time tips
  pointing at the Add button, the Settings gear and Reports. Controls opt in
  with `ref={tipAnchor(id)}`; a tip whose control is not on screen is skipped.
  Tips can be skipped and are remembered on the device.
- **Add sheet:** tiles to record (expense, income, transfer, refund) or plan
  (budget, bill, recurring, goal), plus *Import a bank statement* (CSV).
- **Home:** wordmark with the sync line, then the balance inside a ring of
  this month's daily spending bars (`BalanceHero`), spent / income tiles,
  spending-by-category cards, budget and goal rings (`ProgressRing`),
  upcoming bills and recent transactions.
- **Activity:** large title, pill search, quick filters (All / Expenses /
  Income / Recurring), entries as cards grouped by day with each day's net
  (single-currency days), and a *Repeats* badge on recurring entries.
- **Transaction entry** (amount first, superseded by the dial layout below):
  - A large amount typed on `AmountKeypad`, with + and − for quick sums,
    evaluated exactly in minor units (`domain/money/keypad.ts`).
  - Account and date/time as chips; one-tap category chips (`CategoryChips`);
    *All* opens a searchable grid with subcategories (`CategoryPickerSheet`).
  - Then merchant, notes and tags; split and receipts sit under *More
    options*. The keypad and Save are pinned to the bottom, and the system
    keyboard replaces the keypad while a text field is being edited.
- **Tags:** typed as `#tag` chips. Enter or a comma finishes a tag, an
  existing tag's spelling is reused, and there are at most 20 per entry.
- **Categories screen:** one card per category, showing its subcategories,
  a count, reorder controls and *Add subcategory*. It has search; archived
  categories are listed at the end. A new subcategory starts with its
  parent's colour.

## Keyboard (`<Screen keyboard>`)

Forms use `<Screen keyboard footer={…}>`. The keyboard overlap is measured in
window coordinates (`hooks/useKeyboard.ts`) and the content plus footer are
padded by exactly that amount, so it is correct with Android edge-to-edge
(window not resized), with `adjustResize` (overlap 0) and under headers. The
focused `TextField` is scrolled into view with room for its error text;
dragging the form dismisses the keyboard without losing values. Android back
closes the keyboard first (system behaviour). `BottomSheet` lifts its content
above the keyboard and shrinks long lists instead of pushing the header off
small screens.

## Components (`src/components/ui`)

| Component | Notes |
| --- | --- |
| `Text` | Variants + tone; headings exposed as headers; scales with OS font size |
| `Button` | primary / secondary / ghost / destructive; loading = busy + disabled |
| `IconButton` | Requires `accessibilityLabel` |
| `TextField` | Persistent label, hint, error (announced), secure reveal toggle |
| `FormTextField` | React Hook Form binding; translates Zod i18n keys |
| `Card` | Surface; pressable variant is one accessible button |
| `Screen` | Safe area, scroll, keyboard-aware layout (see above), refresh, footer |
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

## Phase 4 additions (charts)

No chart library is installed: charts are plain React Native views, so there
is no new native dependency and standalone builds are unaffected.

| Component | Notes |
| --- | --- |
| `MonthlyColumns` | Income vs spending per month on one zero-based axis; legend always shown; each month is a button with a full written description; months before any data are drawn as a dashed outline ("No data yet"), distinct from zero; a table view is offered |
| `BalanceColumns` | One account's balance on a single axis including zero (liabilities below the line); dates before the opening balance are outlines; the chart's accessibility label lists every value |
| `ShareBar` | Thin proportional bar; hidden from screen readers because the value is always written beside it |
| `ReportRow`, `PeriodPicker`, `ChangeLine`, `ExcludedNote` | Report building blocks; comparisons are written with an arrow icon, never colour-only |

Series colours (`chartIncome` / `chartSpending`): `#2F55D4` / `#EB6834` —
validated as a colour-blind-safe pair (CVD ΔE ≥ 28) with ≥ 3:1 contrast on the
chart surface (also covered by
`theme/__tests__/contrast.test.ts`). Text never uses series colours.

### Entry sheet (current)

The + opens the entry screen directly:
- *Expense / Income / Transfer* in a `SegmentedControl` (*Refund* appears when
  you start from a purchase).
- The amount sits in the middle of a `CategoryDial`, with up to six likely
  categories around it and *All categories* for the full grid.
- *Add receipt* and *More options* buttons.
- A `FormGroup` card of rows: account, date and time, merchant, note.
- Then tags, the split option and receipts.
- A three-column keypad, plus a Save button that reads *Enter an amount* (and
  is disabled) until the amount is positive.
