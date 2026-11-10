import { defineMachine } from '../machine';

/**
 * Donation link review (`donation_links.review_status`; spec
 * `docs/spec/requirements/13_donations.md` link suggestions, migration `0546`).
 *
 * - A suggested link waits as `pending` until a reviewer approves or rejects it
 *   (`admin_review_donation_link`).
 * - Editing the link's content (URL, name, description, category) sends it back to `pending`
 *   for a new review, from either decision (`donation_links_review_guard`).
 *
 * SQL copy: `supabase/migrations/0715_fsm_review_queues.sql`.
 */
export const donationLinkReviewMachine = defineMachine({
  id: 'donation_link_review',
  states: ['pending', 'approved', 'rejected'] as const,
  edges: [
    { from: 'pending', to: 'approved' },
    { from: 'pending', to: 'rejected' },
    { from: 'approved', to: 'pending' },
    { from: 'rejected', to: 'pending' },
  ],
});
