/**
 * Query roots to invalidate when a table changes locally. Queries are keyed
 * by their primary table (`['budgets', …]`), but many are DERIVED from other
 * tables: budget progress from transactions, bill status from payments and
 * transactions, goal progress from contributions. Listing those dependencies
 * here keeps numbers on screen in step with the data — an expense added
 * anywhere refreshes balances, budgets, bills and goals.
 */
export const QUERY_DEPENDENTS: Readonly<Record<string, readonly string[]>> = {
  transactions: ['budgets', 'bills', 'savings_goals', 'recurring_transactions'],
  transaction_splits: ['budgets', 'transactions'],
  transfers: ['transactions', 'savings_goals'],
  categories: ['budgets', 'bills', 'transactions', 'recurring_transactions'],
  accounts: ['bills', 'savings_goals', 'upcoming', 'recurring_transactions'],
  bills: ['upcoming'],
  user_preferences: ['budgets', 'transactions'],
  budget_revisions: ['budgets'],
  bill_payments: ['bills', 'upcoming'],
  goal_contributions: ['savings_goals'],
  // Upcoming cash flow and reminders read rules, occurrences, bills and payments.
  recurring_transactions: ['upcoming'],
  recurring_occurrences: ['recurring_transactions', 'upcoming'],
  // Rates change converted values everywhere (reports and insights live under
  // the 'transactions' root; combined balances under 'accounts').
  exchange_rates: ['accounts', 'transactions', 'budgets', 'bills', 'savings_goals', 'upcoming'],
};

export function queryRootsFor(table: string): string[] {
  return [table, ...(QUERY_DEPENDENTS[table] ?? [])];
}
