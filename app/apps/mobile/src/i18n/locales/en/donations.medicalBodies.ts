// English — curated medical / life-saving bodies directory (FR-DONATE-011).
export const medicalBodies = {
  sectionsTitle: 'Leading organizations',
  linkError: "We couldn't open the link. Try a different browser.",
  openA11y: 'Open the website of {{name}}',
  sections: {
    blood: { title: 'Blood donation', subtitle: 'One hour of your time can save up to three lives' },
    organs: { title: 'Organ & bone marrow donation', subtitle: 'The ADI card and donor registries' },
    firstAid: { title: 'First aid & rescue', subtitle: 'Courses, volunteering and emergency response' },
    equipment: { title: 'Medical equipment loans', subtitle: 'Donate and borrow rehabilitation equipment' },
    support: { title: 'Support for patients & families', subtitle: 'Organizations for care, research and treatment' },
  },
  items: {
    mdaBlood: {
      name: 'Magen David Adom — Blood donation',
      description: 'Find a nearby blood donation site, book a slot and check eligibility.',
    },
    adi: {
      name: 'ADI — National Transplant Center',
      description: 'Sign up as an organ donor and get a digital ADI donor card.',
    },
    ezerMizionMarrow: {
      name: 'Ezer Mizion — Bone marrow registry',
      description: "Join Israel's largest bone marrow donor registry with a simple cheek swab.",
    },
    mdaFirstAid: {
      name: 'Magen David Adom — First aid',
      description: 'First aid courses, first-responder volunteering and rescue equipment donations.',
    },
    unitedHatzalah: {
      name: 'United Hatzalah',
      description: 'Volunteer medics who reach the scene within minutes. Volunteer or donate.',
    },
    hatzalahIsrael: {
      name: 'Hatzalah Israel',
      description: 'Volunteer rescue organization offering first aid training and emergency response.',
    },
    zaka: {
      name: 'ZAKA',
      description: 'Emergency and disaster response, rescue and victim identification.',
    },
    yadSarah: {
      name: 'Yad Sarah',
      description: 'Free loans of medical and rehabilitation equipment; donate equipment you no longer need.',
    },
    ezerMizionSupport: {
      name: 'Ezer Mizion — Family support',
      description: 'Medical equipment loans, support for patients and families, and help at home.',
    },
    cancerAssociation: {
      name: 'Israel Cancer Association',
      description: 'Support for patients and families, information, prevention and research funding.',
    },
    eran: {
      name: 'ERAN — Emotional first aid',
      description: '24/7 emotional support hotline at *1201, with volunteering opportunities.',
    },
    saveAChildsHeart: {
      name: "Save a Child's Heart",
      description: 'Life-saving heart surgery for children from developing countries, in Israeli hospitals.',
    },
    alyn: {
      name: 'ALYN Pediatric Rehabilitation Hospital',
      description: 'Rehabilitation for children with disabilities. Donate or volunteer.',
    },
  },
} as const;
