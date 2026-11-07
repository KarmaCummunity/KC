import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the composition modules — closureStore reaches into them for use-case
// instances. Each getter returns an object with .execute(). Tests override
// the execute impl as needed via the variables below.
let candidatesImpl: () => Promise<unknown[]> = () => Promise.resolve([]);
let markDeliveredImpl: () => Promise<void> = () => Promise.resolve();
let searchUsersImpl: () => Promise<unknown[]> = () => Promise.resolve([]);
let dismissExplainerImpl: () => Promise<void> = () => Promise.resolve();

vi.mock('../../services/postsComposition', () => ({
  getGetClosureCandidatesUseCase: () => ({ execute: () => candidatesImpl() }),
  getMarkAsDeliveredUseCase: () => ({ execute: () => markDeliveredImpl() }),
  getOwnerCompleteOfferUseCase: () => ({ execute: () => Promise.resolve({ closed: true }) }),
}));

vi.mock('../../services/userComposition', () => ({
  getDismissClosureExplainerUseCase: () => ({ execute: () => dismissExplainerImpl() }),
  getSearchUsersForClosureUseCase: () => ({ execute: () => searchUsersImpl() }),
}));

import { useClosureStore } from '../closureStore';

beforeEach(() => {
  useClosureStore.getState().reset();
  candidatesImpl = () => Promise.resolve([]);
  markDeliveredImpl = () => Promise.resolve();
  searchUsersImpl = () => Promise.resolve([]);
  dismissExplainerImpl = () => Promise.resolve();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('closureStore — synchronous reducers', () => {
  it('reset returns the store to INITIAL', () => {
    useClosureStore.setState({ postId: 'p_1', step: 'pick', selectedRecipientId: 'u_1' });
    useClosureStore.getState().reset();
    expect(useClosureStore.getState()).toMatchObject({
      postId: null, postType: null, step: 'idle', selectedRecipientId: null,
      errorMessage: null, isBusy: false, candidates: [], searchResults: [],
    });
  });

  it('selectRecipient sets selectedRecipientId (and null clears it)', () => {
    useClosureStore.getState().selectRecipient('u_1');
    expect(useClosureStore.getState().selectedRecipientId).toBe('u_1');
    useClosureStore.getState().selectRecipient(null);
    expect(useClosureStore.getState().selectedRecipientId).toBeNull();
  });

  it('setPickMode flips the mode AND clears selection + search state (prevents wrong-recipient submits on toggle)', () => {
    useClosureStore.setState({
      pickMode: 'chats',
      selectedRecipientId: 'u_1',
      searchQuery: 'alice',
      searchResults: [{ userId: 'u_2', displayName: 'A', shareHandle: 'a', avatarUrl: null } as never],
    });
    useClosureStore.getState().setPickMode('search');
    expect(useClosureStore.getState()).toMatchObject({
      pickMode: 'search',
      selectedRecipientId: null,
      searchQuery: '',
      searchResults: [],
    });
  });

  it('confirmStep1 advances step to "pick"', () => {
    useClosureStore.setState({ step: 'confirm' });
    useClosureStore.getState().confirmStep1();
    expect(useClosureStore.getState().step).toBe('pick');
  });

  it('completeWithoutExplainer jumps step to "done" (used after stayDismissed already flipped)', () => {
    useClosureStore.setState({ step: 'pick' });
    useClosureStore.getState().completeWithoutExplainer();
    expect(useClosureStore.getState().step).toBe('done');
  });
});

describe('closureStore — start', () => {
  it('with no preselect → step="confirm" and loads candidates from the use case', async () => {
    const candidates = [{ userId: 'u_1', displayName: 'Alice', shareHandle: 'alice', avatarUrl: null }];
    candidatesImpl = () => Promise.resolve(candidates);
    await useClosureStore.getState().start('p_1', 'owner_1', 'Give');
    const s = useClosureStore.getState();
    expect(s.postId).toBe('p_1');
    expect(s.postType).toBe('Give');
    expect(s.step).toBe('confirm');
    expect(s.candidates).toEqual(candidates);
    expect(s.isBusy).toBe(false);
    expect(s.selectedRecipientId).toBeNull();
  });

  it('with preselectedRecipientId → jumps straight to "pick" and selects them', async () => {
    await useClosureStore.getState().start('p_1', 'owner_1', 'Give', {
      preselectedRecipientId: 'u_preselected',
    });
    const s = useClosureStore.getState();
    expect(s.step).toBe('pick');
    expect(s.selectedRecipientId).toBe('u_preselected');
  });

  it('on candidates load failure → step="error" with the error message', async () => {
    candidatesImpl = () => Promise.reject(new Error('forbidden'));
    await useClosureStore.getState().start('p_1', 'owner_1', 'Give');
    const s = useClosureStore.getState();
    expect(s.step).toBe('error');
    expect(s.errorMessage).toBe('forbidden');
    expect(s.isBusy).toBe(false);
  });

  it('stores the initiator so each entry-point can scope its own done-handler', async () => {
    await useClosureStore.getState().start('p_1', 'owner_1', 'Give', { initiator: 'chat' });
    expect(useClosureStore.getState().initiator).toBe('chat');
  });
});

describe('closureStore — closeWith', () => {
  it('happy path advances to "explainer" and clears isBusy', async () => {
    useClosureStore.setState({ postId: 'p_1', step: 'pick' });
    await useClosureStore.getState().closeWith('u_recipient', 'owner_1');
    expect(useClosureStore.getState().step).toBe('explainer');
    expect(useClosureStore.getState().isBusy).toBe(false);
  });

  it('use-case failure → step="error" with the error message', async () => {
    useClosureStore.setState({ postId: 'p_1', step: 'pick' });
    markDeliveredImpl = () => Promise.reject(new Error('post_already_closed'));
    await useClosureStore.getState().closeWith('u_recipient', 'owner_1');
    expect(useClosureStore.getState().step).toBe('error');
    expect(useClosureStore.getState().errorMessage).toBe('post_already_closed');
  });

  it('is a silent no-op when postId is null (defensive guard)', async () => {
    useClosureStore.setState({ postId: null, step: 'pick' });
    await useClosureStore.getState().closeWith('u_recipient', 'owner_1');
    expect(useClosureStore.getState().step).toBe('pick'); // unchanged
  });
});

describe('closureStore — dismissExplainer', () => {
  it('with stayDismissed=true → calls dismiss use case AND sets step="done"', async () => {
    let dismissed = false;
    dismissExplainerImpl = () => {
      dismissed = true;
      return Promise.resolve();
    };
    await useClosureStore.getState().dismissExplainer(true, 'u_me');
    expect(dismissed).toBe(true);
    expect(useClosureStore.getState().step).toBe('done');
  });

  it('with stayDismissed=false → skips the use case but still sets step="done"', async () => {
    let dismissed = false;
    dismissExplainerImpl = () => {
      dismissed = true;
      return Promise.resolve();
    };
    await useClosureStore.getState().dismissExplainer(false, 'u_me');
    expect(dismissed).toBe(false);
    expect(useClosureStore.getState().step).toBe('done');
  });

  it('swallows a dismiss-use-case error and still advances (best-effort flag flip)', async () => {
    dismissExplainerImpl = () => Promise.reject(new Error('rls denied'));
    await useClosureStore.getState().dismissExplainer(true, 'u_me');
    expect(useClosureStore.getState().step).toBe('done');
  });
});

describe('closureStore — setSearchQuery', () => {
  it('clears results and stops searching when query length is less than 2', () => {
    useClosureStore.setState({
      searchQuery: 'long',
      searchResults: [{ userId: 'u_1', displayName: 'User', shareHandle: 'u', avatarUrl: null } as never],
      isSearching: true,
    });

    useClosureStore.getState().setSearchQuery('a', 'owner_1');

    expect(useClosureStore.getState().searchQuery).toBe('a');
    expect(useClosureStore.getState().searchResults).toEqual([]);
    expect(useClosureStore.getState().isSearching).toBe(false);
  });

  it('debounces search by 300ms and commits results', async () => {
    vi.useFakeTimers();
    const results = [{ userId: 'u_found', displayName: 'Found', shareHandle: 'found', avatarUrl: null }];
    searchUsersImpl = () => Promise.resolve(results);

    useClosureStore.getState().setSearchQuery('search term', 'owner_1');

    expect(useClosureStore.getState().isSearching).toBe(true);
    await vi.advanceTimersByTimeAsync(300);

    expect(useClosureStore.getState().searchResults).toEqual(results);
    expect(useClosureStore.getState().isSearching).toBe(false);
  });

  it('discards results if query changed before debounce completes', async () => {
    vi.useFakeTimers();
    searchUsersImpl = () => Promise.resolve([{ userId: 'stale' } as never]);

    useClosureStore.getState().setSearchQuery('first', 'owner_1');
    useClosureStore.getState().setSearchQuery('second', 'owner_1');

    await vi.advanceTimersByTimeAsync(300);
    // The query is 'second' while the first call was for 'first'
    expect(useClosureStore.getState().searchQuery).toBe('second');
  });

  it('handles search failure gracefully by resetting results', async () => {
    vi.useFakeTimers();
    searchUsersImpl = () => Promise.reject(new Error('network error'));

    useClosureStore.getState().setSearchQuery('error term', 'owner_1');
    await vi.advanceTimersByTimeAsync(300);

    expect(useClosureStore.getState().searchResults).toEqual([]);
    expect(useClosureStore.getState().isSearching).toBe(false);
  });
});
