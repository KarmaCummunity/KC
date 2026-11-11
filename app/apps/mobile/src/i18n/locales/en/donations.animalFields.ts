// English — animals field and option labels (adoption, boarding, pet-sitting; migration 0612).
// Spread into `marketplace.field` / `marketplace.option` by donations.marketplaceFields.ts.

export const animalFieldLabels = {
  age_group: 'Age',
  sex: 'Sex',
  size: 'Size',
  neutered: 'Neutered',
  good_with: 'Good with',
  care_mode: 'Type of care',
  location_mode: 'Where',
  starts_on: 'From',
  ends_on: 'Until',
} as const;

export const animalOptionLabels = {
  dog: 'Dog',
  cat: 'Cat',
  rabbit: 'Rabbit',
  bird: 'Bird',
  rodent: 'Rodent',
  reptile: 'Reptile',
  young: 'Young',
  adult: 'Adult',
  senior: 'Senior',
  male: 'Male',
  female: 'Female',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  children: 'Children',
  dogs: 'Dogs',
  cats: 'Cats',
  full_boarding: 'Full boarding',
  part_time: 'Part-time boarding',
  pet_sitting: 'Pet-sitting',
  my_home: 'At my home',
  owner_home: 'At the animal’s home',
} as const;
