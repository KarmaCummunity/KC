/** About UX refresh — mission+team, governance, money, contact channels (v1.0 master narrative). */
export const aboutContentUxRefreshPartB = {
  missionTeamTitle: 'Who We Are & the Team',
  missionTeamIntro:
  'A small team, a big story. The team is taking shape, and the community grows day by day. More people join when they have something to contribute. We\'re building the network together, the team and the whole community already with us: users, volunteers, and advisors who turn the vision into reality. Soon we\'ll register as a nonprofit. All the data will always be out in the open — we don\'t hide, and the road is part of the story.',

  teamPartnerCtaTitle: 'Want to Join the Journey?',
  teamPartnerCtaBody:
    'We\'re open to partners, volunteers, and advisors across different fields — especially in product and community development. Write to us.',

  teamLoadError: 'We couldn\'t load the team. Please try again.',

  // Team expand UX (v1.0 §1.4 + §9.2)
  teamProfileLinkLabel: 'To the community profile',
  teamStoryExpandMore: 'The full story',
  teamStoryExpandLess: 'Less',

  /** Copy keyed by `about_team_members.role_key`.  profile name/avatar come from the linked user. */
  teamRoles: {
    founder: {
      role: 'Project Founder',
      bio: 'Nave, founder of Karma. I built this project after realizing that the world of giving isn\'t short on money — it\'s short on knowledge, transparency, and technology.',
      bioFull:
        'The world of philanthropy isn\'t short on money. It\'s short on knowledge, transparency, technology, and efficiency.\n\n' +
        'I carried that insight for years without knowing this was my project. I grew up in a religious-Zionist family, and back in high school, thanks to an environment that pushed for excellence, I completed a degree in computer science. At the same time I began asking questions about religion and God, and in the end I left the faith with questions.\n\n' +
        'After a mixed pre-army program, a lot of philosophy, and an encounter with the many layers of Israeli society — I enlisted in the army in the MA"B unit — a technology unit in the Air Force where I developed code for fighter jets. \nUp until then, everywhere in my life I was surrounded by people who wanted to excel. In the army I saw the contrast: there were many smart, high-quality people, and very few who truly excelled; the projects were slow, there was a lack of personal attention and care for the individual, and the standard was mediocrity. That contrast taught me something about community. A community with a clear vision and strong tools has tremendous power.\n\n' +
        'I wanted to plant that same insight in the world of giving and philanthropy — what had worked on me and on those around me for years. But how do you turn people from all over the world into a strong community with a vision that pushes toward excellence and connection? And all without tools or money, without experience, and without a community. So I started small, a spark of an idea to connect gemachs (free-loan societies) to social networks, and that way harness those networks for doing good and giving. From there it rolled along — I consulted, took things apart and rebuilt them, and sharpened the idea. A new social network, for social good only. One place that centers every kind of social good in the world, from handing off belongings, money donations and volunteering, through donations of knowledge and food, all the way to hosting and blood and organ donation.\n\n' +
        'Today we\'re at the first step: an app for handing off belongings for free, in Hebrew, in Israel. We\'ll keep growing and expanding, advancing and improving, and of course we\'ll document it all for you! \n\n This is exactly where real things begin.',
    },
  },

  roadmapPhases: [
    {
      label: 'Phase 1',
      severity: 'current',
      status: 'Now',
      title: 'Stable core',
      summary:
        'What already works: handing off belongings, posts, chat, privacy, reports, basic statistics — and 9 donation categories in the Donations tab.',
      details:
        'Right now we\'re stabilizing the experience, strengthening safety and reports, and supporting the early community — transparent about what works and what\'s still being built.',
    },
    {
      label: 'Phase 2',
      severity: 'soon',
      status: 'Coming soon',
      title: 'Community depth',
      summary:
        'Full in-app flows for donations of time, money and knowledge. Better discovery, transparent moderation, improved onboarding — and links to nonprofits.',
      details:
        'The goal: to connect "someone close to me" with a real need — with less noise and more clarity. Direct in-app donations to the project will open after nonprofit registration.',
    },
    {
      label: 'Phase 3',
      severity: 'future',
      status: 'In the future',
      title: 'Broad impact',
      summary:
        'Partnerships, community events, education for responsible giving, community leaders — and full flows for all 9 categories.',
      details:
        'We\'ll build healthy processes for community leaders, without burdening those who need help — always through the lens of safety.',
    },
    {
      label: 'Phase 4',
      severity: 'long-term',
      status: 'Long term',
      title: 'Beyond belongings',
      summary:
        'International expansion, KC as a transparent conduit for donations to other nonprofits — and a voting mechanism for all users, on top of a firm charter.',
      details:
        'We\'ll open tracks for time and expertise only once the safeguards are ready. We\'ll measure and publish honestly — even when the numbers aren\'t flattering. Going international at a pace that respects local cultures.',
    },
  ],

  // Phase labels shared by Governance + Money sections
  phaseLabelToday: 'Today',
  phaseLabelSoon: 'Coming soon',
  phaseLabelFuture: 'In the future',

  // Logo "More on the Logo" dropdown (v1.0 §2.2–§2.3)
  logoTitle: 'More on the Logo',
  logoLead: 'A whole heart, one world, and a mirror connecting the two.',
  logoA11yLabel: 'The Karma Community logo',
  logoExpandOpen: 'The story behind the logo',
  logoExpandClose: 'Less',
  logoParagraph1:
    'Take a look at the logo. On the left is our fundamental shape — the K of Karma, and the C of Community. Without the other side, it\'s an unfinished shape: half a heart, half a circle.',
  logoParagraph2:
    'Then there\'s the right side — and it\'s not a new side. It\'s a mirror. Everything on the left returns on the right as a mirror image. The moment the mirror enters, the half-heart of the K becomes a whole heart, and the C closes into a circle — planet Earth, with the continents at its center.',
  logoParagraph3:
    'Karma is the heart — giving. Community is the globe — unity. One can\'t live without the other.',
  logoPullQuoteCaption: 'To English-reading eyes, the logo reads in a single touch.',
  logoParagraph4:
    'And in Hebrew? There\'s a little surprise here. Try typing the letters K and C with the keyboard set to Hebrew — you\'ll get exactly the word "lev" (heart). We didn\'t plan that. It just happened on its own.',
  logoJourneyKicker: 'A little journey',
  logoJourneyText:
    'We started with a sketch on paper — a heart, a screen, an idea of connection. Six versions of refinement later, we arrived at today\'s logo.',
  logoImageA11yLabel: 'Logo version {{n}} of 6',

  // Governance — new section (v1.0 §10)
  governanceTitle: 'Decision-Making',
  governanceLead: 'The vision is fixed; the community decides the path.',
  governanceTodayTitle: 'Today',
  governanceTodayBody:
    'Nave (the founder) decides, with 2-3 volunteers helping out. Small, flexible, fast.',
  governanceAmutaTitle: 'When we register as a nonprofit',
  governanceAmutaBody:
    'A proper, public board of directors, a CEO, and an audit committee as required by law. Plus — a firm charter with the values and direction. The values are locked — even if the organization\'s leaders change.',
  governanceFutureTitle: 'In the distant future',
  governanceFutureBody:
    'A democratic vote for all users, on top of the permanent constitution. You are the community — you decide the path, within a framework that protects the values.',

  contactChannelsTitle: 'Contact Channels',
  contactWhatsappGroupLabel: 'WhatsApp — community',
  contactWhatsappPersonalLabel: 'WhatsApp — Nave (personal)',
  contactEmailNaveLabel: 'Email',
  /** Default `subject=` for About → Contact mailto links (URL-encoded at runtime). */
  contactMailSubjectDefault: 'A message from Karma Community',
  /** Prefilled `text=` for personal WhatsApp deep link (URL-encoded at runtime). */
  contactWhatsappPersonalPrefill: 'Hi Nave, I came from Karma Community. I\'d love to talk.',
  contactDonationTitle: 'Direct support (outside the app)',
  contactDonationNote:
    'Direct donation via Bit or PayBox to 0528616878 — outside the product. The money sits in a fund until we register as a nonprofit. No collection and no guarantee from the app.',
  contactSupportRow: 'Report a bug or request a feature — through "Report an issue" in Settings (recommended).',
  contactLinkError: 'We couldn\'t open the link on this device.',

  roadmapExpandMore: 'Read more',
  roadmapExpandLess: 'Less',

  valuesText:
    'Our six values: transparency, renewal, reliability, and community. As a choice, when it\'s right for you.\n\n' +
    'Giving goes both ways. Everyone has something to contribute and something to ask for. What one person doesn\'t need can change someone else\'s day.\n\n' +
    'We believe in transparency but allow privacy. Privacy is a tool you control over your private and personal information; all data is kept and counted within the community\'s figures.',

  valuesList: [
    { icon: 'eye-outline', label: 'Transparency' },
    { icon: 'leaf-outline', label: 'Renewal' },
    { icon: 'shield-checkmark-outline', label: 'Reliability' },
    { icon: 'people-outline', label: 'Community' },
  ],
} as const;
