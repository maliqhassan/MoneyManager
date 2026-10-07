import { Redirect } from 'expo-router';

/**
 * Placeholder route backing the centre "+" tab slot. The tab button opens
 * the /add sheet instead of navigating here; a deep link to /compose is
 * redirected to Home.
 */
export default function ComposeRoute() {
  return <Redirect href="/" />;
}
