// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
const share = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/triggerResearchShare', () => ({ triggerResearchShare: share }));
vi.mock('../../../store/authStore', () => ({ useAuthStore: (select: (s: { isAuthenticated: boolean }) => unknown) => select({ isAuthenticated: false }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import ResearchThanksScreen from '../../../../app/research/thanks.web';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
for (const [kind, label] of [['shared','statusShared'],['copied','statusCopied'],['failed','statusFailed']] as const) {
 it('shows ' + kind + ' feedback on the actual thank-you page', async () => {
  share.mockImplementation(async (_src, labels, feedback) => { feedback?.(labels['toast'+kind[0].toUpperCase()+kind.slice(1)], kind==='failed'?'error':'success',2200);return {kind}; });
  const {getByRole,getByTestId}=render(<ThemeProvider mode="light" systemScheme="light" setMode={()=>{}}><ResearchThanksScreen/></ThemeProvider>);
  await act(async()=>{fireEvent.click(getByRole('button',{name:'research.share.thanksTitle'}));});
  expect(getByTestId('research-share-status').textContent).toBe('research.share.'+label);
 });
}

it('auto-clears feedback after 2.2 seconds and keeps dismissal silent', async () => {
 vi.useFakeTimers();
 share.mockImplementationOnce(async (_src, labels, feedback) => { feedback(labels.toastCopied,'success',2200);return {kind:'copied'}; }).mockResolvedValueOnce({kind:'dismissed'});
 const {getByRole,queryByTestId}=render(<ThemeProvider mode="light" systemScheme="light" setMode={()=>{}}><ResearchThanksScreen/></ThemeProvider>);
 await act(async()=>{fireEvent.click(getByRole('button',{name:'research.share.thanksTitle'}));});
 expect(queryByTestId('research-share-status')).toBeTruthy();
 await act(async()=>{vi.advanceTimersByTime(2200);});expect(queryByTestId('research-share-status')).toBeNull();
 await act(async()=>{fireEvent.click(getByRole('button',{name:'research.share.thanksTitle'}));});expect(queryByTestId('research-share-status')).toBeNull();
});
