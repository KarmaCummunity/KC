// FR-POST-023 — share texts (English twin of he/modules/share.ts; the key sets must match, see
// i18n/__tests__/localeParity.test.ts).

/** A world's headlines: an offer or a request, each while open and once closed. */
const world = (
  offerOpen: string,
  offerClosed: string,
  requestOpen: string,
  requestClosed: string,
) => ({
  offer: { open: offerOpen, closed: offerClosed },
  request: { open: requestOpen, closed: requestClosed },
});

export const shareEn = {
  dialogTitle: 'Share',
  copiedToast: 'Link copied',
  failedToast: 'Sharing failed, please try again.',
  post: {
    a11y: 'Share this post',
    headline: {
      items: world(
        '🎁 An item waiting for a new home on Karma Community',
        '✅ An item successfully handed over on Karma Community',
        '🔍 Looking for an item on Karma Community. Maybe you have one?',
        '✅ An item request that was answered on Karma Community',
      ),
      food: world(
        '🍲 Food waiting for whoever needs it, on Karma Community',
        '✅ Food successfully handed over on Karma Community',
        '🥣 Looking for food on Karma Community. Who can help?',
        '✅ A food request that was answered on Karma Community',
      ),
      rides: world(
        '🚗 A ride on offer on Karma Community',
        '✅ A ride that took place on Karma Community',
        '🙋 Looking for a ride on Karma Community',
        '✅ A ride request that was answered on Karma Community',
      ),
      time: world(
        '⏰ Volunteers offering their time on Karma Community',
        '✅ A volunteering session that took place on Karma Community',
        '🤝 Looking for volunteers on Karma Community',
        '✅ A volunteering request that was answered on Karma Community',
      ),
      housing: world(
        '🏠 A place to stay on Karma Community',
        '✅ A stay that was arranged on Karma Community',
        '🛏️ Looking for a place to stay on Karma Community',
        '✅ A housing request that was answered on Karma Community',
      ),
      animals: world(
        '🐾 An offer for animals on Karma Community',
        '✅ Help for an animal that was completed on Karma Community',
        '🐾 Looking for help for an animal on Karma Community',
        '✅ A request for animal help that was answered on Karma Community',
      ),
      knowledge: world(
        '📚 Happy to teach and share knowledge on Karma Community',
        '✅ A lesson that took place on Karma Community',
        '🎓 Looking for someone to teach on Karma Community',
        '✅ A teacher was found on Karma Community',
      ),
      challenges: world(
        '🏆 A challenge inviting you to join on Karma Community',
        '✅ A challenge that was completed on Karma Community',
        '🏆 Looking for partners for a challenge on Karma Community',
        '✅ A challenge that was completed on Karma Community',
      ),
      generic: world(
        '💚 An offer from Karma Community',
        '✅ An offer that was taken up on Karma Community',
        '💚 A request for help from Karma Community',
        '✅ A request that was answered on Karma Community',
      ),
    },
    cta: {
      items: { offer: 'Maybe it is just for you. Tap for details 👇', request: 'If you have one, tap for details 👇' },
      food: { offer: 'Enjoy! Tap to arrange it 👇', request: 'If you can help, tap for details 👇' },
      rides: { offer: 'If it is on your way, tap for details 👇', request: 'If you are heading there, tap for details 👇' },
      time: { offer: 'Need a hand? Tap for details 👇', request: 'Want to volunteer? Tap for details 👇' },
      housing: { offer: 'Looking for a place? Tap for details 👇', request: 'Have a place to offer? Tap for details 👇' },
      animals: { offer: 'Tap to arrange it 👇', request: 'If you can help, tap for details 👇' },
      knowledge: { offer: 'Want to learn? Tap for details 👇', request: 'Can you teach? Tap for details 👇' },
      challenges: { offer: 'Want to join? Tap for details 👇', request: 'Want to join? Tap for details 👇' },
      generic: { offer: 'Tap for details 👇', request: 'If you can help, tap for details 👇' },
    },
    ctaClosed: 'Tap to see the details 👇',
    label: {
      publisher: 'Posted by:',
      counterparty: 'Partner:',
      title: 'Title:',
      route: 'Route:',
      description: 'Description:',
      category: 'Category:',
      location: 'Location:',
      postedAt: 'Posted:',
      status: 'Status:',
    },
  },
  profile: {
    a11y: 'Share this profile',
    menuItem: 'Share profile',
    headline: "👋 {{name}}'s profile on Karma Community",
    headlineAnonymous: '👋 A profile on Karma Community',
    body: 'A community that gives and asks without buying.',
    cta: 'Tap to meet them 👇',
  },
};
