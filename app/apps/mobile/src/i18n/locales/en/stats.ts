// English — Statistics dashboard (FR-STATS-001..004).
// Locale file under `locales/en/`; composed into the bundle via `locales/en/index.ts`.

export const stats = {
  title: 'The community in numbers',
  subtitle: 'Personal counters, recent activity, and community status',
  given: 'Items I gave',
  received: 'Items I received',
  activePosts: 'Active posts',
  communityTitle: 'In the community now',
  communityUsers: 'Registered users',
  communityPosts: 'Open posts (public)',
  communityDelivered: 'Completed handovers',
  communityHint: 'The numbers update automatically every minute.',
  recentActivity: 'What’s happening with me',
  // FR-STATS-008 — the member's own givings per world.
  byWorldTitle: 'My givings by world',
  byWorldGiven: 'Given',
  byWorldReceived: 'Received',
  byWorldClosed: 'Closed',
  byWorldEmpty: 'Once a giving is handed over, it shows here under its world.',
  activityEmpty: 'No activity to show yet. Posting or closing a post will appear here.',
  activitySomeone: 'User',
  activityKind: {
    post_created: 'You created the post “{{title}}”',
    post_closed_delivered: 'You marked “{{title}}” as delivered',
    post_closed_no_recipient: 'You closed “{{title}}” without marking a recipient',
    post_reopened: 'You reopened “{{title}}”',
    marked_as_recipient: '{{owner}} marked you as the recipient of “{{title}}”',
    unmarked_as_recipient: 'You removed the recipient mark from “{{title}}”',
    post_expired: 'The post “{{title}}” expired',
    post_removed_admin: 'The post “{{title}}” was removed by the team',
  },
  // #2078 — volunteering takes place; it is not delivered to a recipient.
  activityKindTime: {
    post_closed_delivered: 'You marked the volunteering “{{title}}” as having taken place',
    marked_as_recipient: '{{owner}} marked you in the volunteering “{{title}}”',
    unmarked_as_recipient: 'You removed your mark from the volunteering “{{title}}”',
  },
};
