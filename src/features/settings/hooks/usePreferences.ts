import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';
import { useRepositories } from '@/providers/DataProvider';

/** Synced user preferences; null until the server-created row has been pulled. */
export function usePreferences() {
  const { preferences } = useRepositories();
  return useQuery({
    queryKey: queryKeys.preferences.current(),
    queryFn: () => preferences.get(),
  });
}
