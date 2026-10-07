import type { CategoryKind } from '../enums';

/**
 * Default category tree. Seeded SERVER-side at sign-up (and backfilled for
 * existing users) by supabase/migrations/20261009090000_transactions_categories.sql
 * — never created on the device, so several devices cannot create
 * duplicates. This client copy exists only to translate seeded names
 * (via `categories.system.<key>`) while the user has not renamed them.
 *
 * Keep in sync with the migration. System keys are permanent identifiers.
 */
export interface DefaultCategory {
  key: string;
  kind: CategoryKind;
  /** English name stored in the database at seed time. */
  name: string;
  icon: string;
  color: string;
  parent: string | null;
}

const e = (
  key: string,
  name: string,
  icon: string,
  color: string,
  parent: string | null = null,
): DefaultCategory => ({ key, kind: 'expense', name, icon, color, parent });
const i = (key: string, name: string, icon: string, color: string): DefaultCategory => ({
  key,
  kind: 'income',
  name,
  icon,
  color,
  parent: null,
});

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  e('housing', 'Housing', 'home-outline', '#2F55D4'),
  e('rent', 'Rent', 'key-outline', '#2F55D4', 'housing'),
  e('mortgage', 'Mortgage', 'business-outline', '#2F55D4', 'housing'),
  e('home_maintenance', 'Home maintenance', 'hammer-outline', '#2F55D4', 'housing'),

  e('food', 'Food', 'restaurant-outline', '#13774F'),
  e('groceries', 'Groceries', 'cart-outline', '#13774F', 'food'),
  e('dining', 'Restaurants', 'fast-food-outline', '#13774F', 'food'),
  e('coffee', 'Coffee', 'cafe-outline', '#13774F', 'food'),

  e('transport', 'Transportation', 'car-outline', '#0E7490'),
  e('fuel', 'Fuel', 'speedometer-outline', '#0E7490', 'transport'),
  e('public_transport', 'Public transport', 'bus-outline', '#0E7490', 'transport'),
  e('taxi_rideshare', 'Taxi & rideshare', 'car-sport-outline', '#0E7490', 'transport'),
  e('car_maintenance', 'Car maintenance', 'construct-outline', '#0E7490', 'transport'),

  e('utilities', 'Bills & utilities', 'flash-outline', '#B45309'),
  e('electricity', 'Electricity', 'bulb-outline', '#B45309', 'utilities'),
  e('water', 'Water', 'water-outline', '#B45309', 'utilities'),
  e('internet', 'Internet', 'wifi-outline', '#B45309', 'utilities'),
  e('mobile_phone', 'Mobile phone', 'phone-portrait-outline', '#B45309', 'utilities'),

  e('shopping', 'Shopping', 'bag-handle-outline', '#6B46C1'),
  e('clothing', 'Clothing', 'shirt-outline', '#6B46C1', 'shopping'),
  e('electronics', 'Electronics', 'laptop-outline', '#6B46C1', 'shopping'),
  e('personal_care', 'Personal care', 'sparkles-outline', '#6B46C1', 'shopping'),

  e('health', 'Health', 'medkit-outline', '#C02A35'),
  e('medical', 'Medical', 'pulse-outline', '#C02A35', 'health'),
  e('pharmacy', 'Pharmacy', 'bandage-outline', '#C02A35', 'health'),
  e('insurance', 'Insurance', 'shield-checkmark-outline', '#C02A35', 'health'),

  e('entertainment', 'Entertainment', 'film-outline', '#BE185D'),
  e('movies', 'Movies', 'videocam-outline', '#BE185D', 'entertainment'),
  e('games', 'Games', 'game-controller-outline', '#BE185D', 'entertainment'),
  e('events', 'Events', 'ticket-outline', '#BE185D', 'entertainment'),

  e('travel', 'Travel', 'airplane-outline', '#1E3A8A'),
  e('flights', 'Flights', 'airplane-outline', '#1E3A8A', 'travel'),
  e('hotels', 'Hotels', 'bed-outline', '#1E3A8A', 'travel'),
  e('travel_other', 'Other travel', 'map-outline', '#1E3A8A', 'travel'),

  e('education', 'Education', 'school-outline', '#2F55D4'),
  e('subscriptions', 'Subscriptions', 'repeat-outline', '#0E7490'),

  e('financial', 'Financial', 'card-outline', '#4D5868'),
  e('fees', 'Bank fees', 'receipt-outline', '#4D5868', 'financial'),
  e('interest_paid', 'Interest', 'trending-down-outline', '#4D5868', 'financial'),

  e('family', 'Family', 'people-outline', '#B45309'),
  e('gifts_donations', 'Gifts & donations', 'gift-outline', '#BE185D'),
  e('other_expense', 'Other', 'ellipsis-horizontal', '#4D5868'),

  i('salary', 'Salary', 'briefcase-outline', '#13774F'),
  i('freelance', 'Freelance', 'laptop-outline', '#13774F'),
  i('business', 'Business', 'storefront-outline', '#0E7490'),
  i('investment_income', 'Investment income', 'trending-up-outline', '#2F55D4'),
  i('interest_income', 'Interest', 'cash-outline', '#2F55D4'),
  i('rental_income', 'Rental income', 'home-outline', '#6B46C1'),
  i('refunds_income', 'Refunds', 'arrow-undo-outline', '#4D5868'),
  i('gifts_received', 'Gifts', 'gift-outline', '#BE185D'),
  i('other_income', 'Other', 'ellipsis-horizontal', '#4D5868'),
];

const BY_KEY = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c]));

export function findDefaultCategory(systemKey: string | null): DefaultCategory | null {
  return systemKey ? (BY_KEY.get(systemKey) ?? null) : null;
}
