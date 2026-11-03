// FR-DONATE-011 — curated, app-wide directory of Israeli life-saving and medical bodies.
// Static config only: user-visible copy (name/description) lives in the i18n bundle under
// `medicalBodies.items.<id>` so the list stays localizable and free of inline strings.
import type { Ionicons } from '@expo/vector-icons';

export type MedicalSectionId = 'blood' | 'organs' | 'firstAid' | 'equipment' | 'support';

/** Official website per body; always https, opened in the external browser. */
const MEDICAL_BODY_URLS = {
  mdaBlood: 'https://www.mdais.org',
  adi: 'https://www.adi.org.il',
  ezerMizionMarrow: 'https://ezermizion.org',
  mdaFirstAid: 'https://www.mdais.org',
  unitedHatzalah: 'https://israelrescue.org',
  hatzalahIsrael: 'https://hatzalah.org.il',
  zaka: 'https://www.zaka.org.il',
  yadSarah: 'https://yadsarah.org',
  ezerMizionSupport: 'https://ezermizion.org',
  cancerAssociation: 'https://www.cancer.org.il',
  eran: 'https://www.eran.org.il',
  saveAChildsHeart: 'https://saveachildsheart.org',
  alyn: 'https://www.alyn.org',
} as const;

export type MedicalBodyId = keyof typeof MEDICAL_BODY_URLS;

export interface MedicalBody {
  /** Stable id; doubles as the i18n key suffix (`medicalBodies.items.<id>`). */
  readonly id: MedicalBodyId;
  readonly url: string;
}

export interface MedicalSection {
  readonly id: MedicalSectionId;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly bodies: readonly MedicalBody[];
}

const body = (id: MedicalBodyId): MedicalBody => ({ id, url: MEDICAL_BODY_URLS[id] });

/** Display order is the array order: the most life-critical actions come first. */
export const MEDICAL_SECTIONS: readonly MedicalSection[] = [
  { id: 'blood', icon: 'water-outline', bodies: [body('mdaBlood')] },
  { id: 'organs', icon: 'heart-outline', bodies: [body('adi'), body('ezerMizionMarrow')] },
  {
    id: 'firstAid',
    icon: 'medkit-outline',
    bodies: [body('mdaFirstAid'), body('unitedHatzalah'), body('hatzalahIsrael'), body('zaka')],
  },
  { id: 'equipment', icon: 'bandage-outline', bodies: [body('yadSarah'), body('ezerMizionSupport')] },
  {
    id: 'support',
    icon: 'people-outline',
    bodies: [body('cancerAssociation'), body('eran'), body('saveAChildsHeart'), body('alyn')],
  },
];
