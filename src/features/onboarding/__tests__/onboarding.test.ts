import type { StateStorage } from 'zustand/middleware';

import type { FormatSettings } from '@/i18n/formatter';

import {
  completionUpdate,
  draftFormatSettings,
  nextStep,
  ONBOARDING_STEPS,
  resolveAppGate,
  suggestDraft,
} from '../model';
import { createOnboardingStore } from '../store';

// The module-level store instance needs a storage; tests use their own instances.
jest.mock('@/stores/persistStorage', () => {
  const mockData = new Map<string, string>();
  return {
    devicePersistStorage: {
      getItem: (k: string) => mockData.get(k) ?? null,
      setItem: (k: string, v: string) => void mockData.set(k, v),
      removeItem: (k: string) => void mockData.delete(k),
    },
  };
});

function memoryStorage(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const device: FormatSettings = {
  locale: 'en-PK',
  language: 'en',
  region: 'PK',
  numberFormat: 'locale',
  dateFormat: 'locale',
  timeZone: 'Asia/Karachi',
  firstDayOfWeek: 1,
  baseCurrency: 'PKR',
};

describe('onboarding model', () => {
  it('walks the steps in order and stops at ready', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'welcome',
      'currency',
      'region',
      'preferences',
      'account',
      'ready',
    ]);
    expect(nextStep('welcome')).toBe('currency');
    expect(nextStep('account')).toBe('ready');
    expect(nextStep('ready')).toBe('ready');
  });

  it('suggests device settings and falls back for unsupported languages', () => {
    expect(suggestDraft(device)).toEqual({
      currency: 'PKR',
      region: 'PK',
      language: 'en',
      timeZone: 'Asia/Karachi',
      firstDayOfWeek: 1,
      dateFormat: 'locale',
      numberFormat: 'locale',
    });
    expect(suggestDraft({ ...device, language: 'ur' }).language).toBe('en');
  });

  it('derives formatting settings and the completion write from the draft', () => {
    const draft = { ...suggestDraft(device), region: 'AE', currency: 'AED' as const };
    expect(draftFormatSettings(draft)).toMatchObject({ locale: 'en-AE', baseCurrency: 'AED' });
    expect(completionUpdate(draft, '2026-10-08T10:00:00.000Z')).toEqual({
      baseCurrency: 'AED',
      region: 'AE',
      language: 'en',
      locale: 'en-AE',
      timeZone: 'Asia/Karachi',
      firstDayOfWeek: 1,
      dateFormat: 'locale',
      numberFormat: 'locale',
      onboardingCompletedAt: '2026-10-08T10:00:00.000Z',
    });
  });
});

describe('resolveAppGate', () => {
  const base = { preferencesLoading: false, canSyncNow: true, firstSyncSettled: true };

  it('shows the app when onboarding is complete', () => {
    expect(
      resolveAppGate({ ...base, preferences: { onboardingCompletedAt: '2026-10-08T00:00:00Z' } }),
    ).toBe('ready');
  });

  it('shows onboarding when it is incomplete', () => {
    expect(resolveAppGate({ ...base, preferences: { onboardingCompletedAt: null } })).toBe(
      'onboarding',
    );
  });

  it('waits for the first sync instead of showing onboarding to a returning user', () => {
    expect(resolveAppGate({ ...base, preferences: null, firstSyncSettled: false })).toBe('loading');
    expect(resolveAppGate({ ...base, preferencesLoading: true, preferences: undefined })).toBe(
      'loading',
    );
  });

  it('lets onboarding proceed offline when preferences cannot arrive yet', () => {
    expect(
      resolveAppGate({ ...base, preferences: null, canSyncNow: false, firstSyncSettled: false }),
    ).toBe('onboarding');
    expect(resolveAppGate({ ...base, preferences: null })).toBe('onboarding');
  });
});

describe('onboarding store', () => {
  const draft = suggestDraft(device);

  it('persists progress and resumes after a restart', async () => {
    const storage = memoryStorage();
    const first = createOnboardingStore(storage);
    first.getState().ensure('user-a', draft);
    first.getState().setStep('user-a', 'preferences');
    first.getState().updateDraft('user-a', { currency: 'USD' });
    first.getState().setAccount('user-a', 'acc-1');

    const restarted = createOnboardingStore(storage);
    await restarted.persist.rehydrate();
    expect(restarted.getState().byUser['user-a']).toEqual({
      step: 'preferences',
      draft: { ...draft, currency: 'USD' },
      accountId: 'acc-1',
    });
  });

  it('never resets existing progress and isolates users', () => {
    const store = createOnboardingStore(memoryStorage());
    store.getState().ensure('user-a', draft);
    store.getState().setStep('user-a', 'region');
    expect(store.getState().ensure('user-a', { ...draft, currency: 'EUR' }).step).toBe('region');
    store.getState().ensure('user-b', draft);
    expect(store.getState().byUser['user-b']?.step).toBe('welcome');
  });

  it('clears one user without touching others', () => {
    const storage = memoryStorage();
    const store = createOnboardingStore(storage);
    store.getState().ensure('user-a', draft);
    store.getState().ensure('user-b', draft);
    store.getState().clear('user-a');
    expect(Object.keys(store.getState().byUser)).toEqual(['user-b']);
    expect(storage.data.get('onboarding.v1')).not.toContain('user-a');
  });

  it('ignores updates for users without progress', () => {
    const store = createOnboardingStore(memoryStorage());
    store.getState().setStep('ghost', 'ready');
    store.getState().updateDraft('ghost', { currency: 'USD' });
    expect(store.getState().byUser).toEqual({});
  });
});
