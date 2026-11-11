// Hebrew — animals field and option labels (adoption, boarding, pet-sitting; migration 0612).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const animalFieldLabels = {
  age_group: 'גיל',
  sex: 'מין',
  size: 'גודל',
  neutered: 'מעוקר/מעוקרת',
  good_with: 'מתאים לחיים עם',
  care_mode: 'סוג הטיפול',
  location_mode: 'איפה',
  starts_on: 'מתאריך',
  ends_on: 'עד תאריך',
} as const;

export const animalOptionLabels = {
  dog: 'כלב',
  cat: 'חתול',
  rabbit: 'ארנב',
  bird: 'ציפור',
  rodent: 'מכרסם',
  reptile: 'זוחל',
  young: 'צעיר/ה',
  adult: 'בוגר/ת',
  senior: 'מבוגר/ת',
  male: 'זכר',
  female: 'נקבה',
  small: 'קטן',
  medium: 'בינוני',
  large: 'גדול',
  children: 'ילדים',
  dogs: 'כלבים',
  cats: 'חתולים',
  full_boarding: 'פנסיון מלא',
  part_time: 'פנסיון חלקי',
  pet_sitting: 'בייביסיטר לחיות',
  my_home: 'אצלי בבית',
  owner_home: 'בבית של בעל החיים',
} as const;
