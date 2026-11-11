// ─────────────────────────────────────────────
// FR-CLOSURE-001..005 — composition root for the closure flow.
// Holds: which post is currently being closed, current step,
// recipient candidates. Actions delegate to use cases.
// ─────────────────────────────────────────────

import { create } from 'zustand';
import type { ClosureCandidate } from '@kc/application';
import type { PostType } from '@kc/domain';
import {
  getDismissClosureExplainerUseCase,
  getSearchUsersForClosureUseCase,
} from '../services/userComposition';
import { getGetClosureCandidatesUseCase } from '../services/postsComposition';
import { completeOwnerClosure, type ClosureOutcome } from './completeOwnerClosure';

export type ClosureStep = 'idle' | 'confirm' | 'pick' | 'explainer' | 'done' | 'error';
export type PickMode = 'chats' | 'search';
export type ClosureInitiator = 'post-detail' | 'chat' | 'my-listings' | 'owner-assign' | null;
export type { ClosureOutcome };

interface ClosureState {
  postId: string | null;
  /** Drives Hebrew copy in every step — Give vs Request flips the directional
   *  language ("delivered to" vs "received from") and the Step-1 question. */
  postType: PostType | null;
  /** Listing world (`rides`, `housing`…). Null on a social item post. Drives the sheet wording. */
  worldSlug: string | null;
  step: ClosureStep;
  /** Tracks where the closure flow was initiated so each entry-point's
   *  done-handler only fires for its own closures. */
  initiator: ClosureInitiator;
  /** Listing offers close through owner_complete_offer_with_user. Social posts do not. */
  offerAssign: boolean;
  /** Rides and housing always name a person. Items and animals may close without one. */
  allowCloseWithout: boolean;
  /** Set when the close RPC finishes, before the explainer. */
  lastOutcome: ClosureOutcome | null;
  pickMode: PickMode;
  /** Chat partners (loaded once on start). */
  candidates: ClosureCandidate[];
  /** Search results (refreshed per query). */
  searchResults: ClosureCandidate[];
  searchQuery: string;
  isSearching: boolean;
  selectedRecipientId: string | null;
  errorMessage: string | null;
  isBusy: boolean;
}

interface ClosureActions {
  start(
    postId: string,
    ownerId: string,
    postType: PostType,
    options?: {
      preselectedRecipientId?: string | null;
      initiator?: ClosureInitiator;
      startAt?: 'confirm' | 'pick';
      offerAssign?: boolean;
      allowCloseWithout?: boolean;
      worldSlug?: string | null;
    }
  ): Promise<void>;
  selectRecipient(userId: string | null): void;
  setPickMode(mode: PickMode): void;
  setSearchQuery(query: string, ownerId: string): void;
  confirmStep1(): void;
  closeWith(recipientUserId: string | null, ownerId: string): Promise<void>;
  dismissExplainer(stayDismissed: boolean, userId: string): Promise<void>;
  /** Skip the explainer step and signal success — used when the user has already
   *  ticked "don't show again". Sets step='done' so subscribers (OwnerActionsBar)
   *  can react and refetch their data. */
  completeWithoutExplainer(): void;
  reset(): void;
}

const INITIAL: ClosureState = {
  postId: null,
  postType: null,
  worldSlug: null,
  step: 'idle',
  initiator: null,
  offerAssign: false,
  allowCloseWithout: true,
  lastOutcome: null,
  pickMode: 'chats',
  candidates: [],
  searchResults: [],
  searchQuery: '',
  isSearching: false,
  selectedRecipientId: null,
  errorMessage: null,
  isBusy: false,
};

// Per-store debounce timer for search. Module-scoped because Zustand actions
// don't expose a closure-friendly place to keep one.
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useClosureStore = create<ClosureState & ClosureActions>((set, get) => ({
  ...INITIAL,

  async start(postId, ownerId, postType, options) {
    const preselect = options?.preselectedRecipientId ?? null;
    const offerAssign = options?.offerAssign === true;
    // When the entry-point already knows the recipient (e.g. the chat anchored
    // to this post), pre-select them AND jump straight to the picker step so
    // the user confirms with a single tap. An owner assign opens on the picker.
    set({
      ...INITIAL,
      postId,
      postType,
      worldSlug: options?.worldSlug ?? null,
      step: preselect || options?.startAt === 'pick' ? 'pick' : 'confirm',
      selectedRecipientId: preselect,
      isBusy: true,
      initiator: options?.initiator ?? null,
      offerAssign,
      allowCloseWithout: options?.allowCloseWithout ?? true,
    });
    try {
      const candidates = await getGetClosureCandidatesUseCase().execute({ postId, ownerId });
      set({ candidates, isBusy: false });
    } catch (e) {
      // Assign still works from search when the id is a listing with no anchored chats.
      if (offerAssign) set({ candidates: [], isBusy: false });
      else set({ step: 'error', isBusy: false, errorMessage: (e as Error).message });
    }
  },

  selectRecipient(userId) {
    set({ selectedRecipientId: userId });
  },

  setPickMode(mode) {
    // Clearing the selection on switch prevents accidentally submitting the
    // wrong recipient when the user toggles back and forth.
    set({ pickMode: mode, selectedRecipientId: null, searchQuery: '', searchResults: [] });
  },

  setSearchQuery(query, ownerId) {
    set({ searchQuery: query });
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (query.trim().length < 2) {
      set({ searchResults: [], isSearching: false });
      return;
    }
    set({ isSearching: true });
    searchDebounceTimer = setTimeout(async () => {
      try {
        const results = await getSearchUsersForClosureUseCase().execute({
          query,
          ownerId,
        });
        if (get().searchQuery === query) {
          // Only commit if the query hasn't moved on.
          set({ searchResults: results, isSearching: false });
        }
      } catch {
        if (get().searchQuery === query) set({ searchResults: [], isSearching: false });
      }
    }, 300);
  },

  confirmStep1() {
    set({ step: 'pick' });
  },

  async closeWith(recipientUserId, ownerId) {
    const postId = get().postId;
    if (!postId) return;
    set({ isBusy: true, errorMessage: null });
    try {
      const lastOutcome = await completeOwnerClosure({
        postId,
        ownerId,
        recipientUserId,
        offerAssign: get().offerAssign,
      });
      set({ step: 'explainer', isBusy: false, lastOutcome });
    } catch (e) {
      set({ step: 'error', isBusy: false, errorMessage: (e as Error).message });
    }
  },

  async dismissExplainer(stayDismissed, userId) {
    if (stayDismissed) {
      try {
        await getDismissClosureExplainerUseCase().execute({ userId });
      } catch {
        // Non-blocking — closure already succeeded; the flag flip is best-effort.
      }
    }
    set({ step: 'done' });
  },

  completeWithoutExplainer() {
    set({ step: 'done' });
  },

  reset() {
    set(INITIAL);
  },
}));
