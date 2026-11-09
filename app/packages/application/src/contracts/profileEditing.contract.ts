// Profile-editing contract (G39) — the Edit Profile and onboarding slice of
// IUserRepository, the behaviour every implementation must honour. Mapped to
// docs/spec/requirements/02_profile_and_privacy.md FR-PROFILE-007 (AC1 field rules, AC4
// atomic save) and docs/spec/requirements/01_auth_and_onboarding.md FR-AUTH-007 AC2
// (cold-start bootstrap), FR-AUTH-010 (basic info and skip) and FR-AUTH-011
// (avatar).
//
// Use cases validate every field before they write; the cases below pin the
// data-layer limits behind them (defence in depth), the partial-patch semantics
// of `updateEditableProfile`, and ownership: a member edits and reads the
// private fields of their own profile only.

import type { IUserRepository } from '../ports/IUserRepository';
import type { ContractCase } from './types';
import { assertEqual, assertRejects, assertTrue } from './assert';
import { onboardingProgressCases } from './onboardingProgress.contract';

/** The Edit Profile and onboarding methods of IUserRepository. */
export type ProfileEditing = Pick<
  IUserRepository,
  | 'getEditableProfile'
  | 'updateEditableProfile'
  | 'setAvatar'
  | 'setBiography'
  | 'setContactPhone'
  | 'setProfileAddressLines'
  | 'getOnboardingBootstrap'
  | 'markBasicInfoSkipped'
  | 'clearBasicInfoSkipped'
  | 'setBasicInfo'
  | 'setOnboardingState'
  | 'setDateOfBirth'
>;

type EditableProfile = Awaited<ReturnType<ProfileEditing['getEditableProfile']>>;
/** An edit that writes every field of the Edit Profile form. */
type FullProfileEdit = Required<Parameters<ProfileEditing['updateEditableProfile']>[1]>;

/** FR-PROFILE-007 AC1 limits, as the data layer enforces them. */
export const PROFILE_FIELD_LIMITS = {
  displayNameMax: 50,
  biographyMax: 200,
  contactPhoneMax: 20,
  streetMax: 80,
} as const;

/** A row of the city list (`public.cities`): its id and its Hebrew name. */
export interface ProfileCity {
  readonly id: string;
  readonly name: string;
}

export interface ProfileActor {
  readonly userId: string;
  /** Repository acting as `userId` (for the Supabase adapter: that user's signed-in client). */
  readonly users: ProfileEditing;
}

export interface ProfileEditingContractContext {
  /** Two distinct cities the implementation knows. */
  readonly cities: readonly [ProfileCity, ProfileCity];
  /** A new active member. */
  newActor(): Promise<ProfileActor>;
}

type Ctx = ProfileEditingContractContext;

/** A building number with a Hebrew letter suffix ("12" + alef), which AC1 accepts. */
const HEBREW_SUFFIX_NUMBER = '12\u05D0';

/** Every field of the Edit Profile form set to a valid, non-null value in `city`. */
function fullProfile(city: ProfileCity, tag: string): FullProfileEdit {
  return {
    displayName: `member ${tag}`,
    city: city.id,
    cityName: city.name,
    profileStreet: `street ${tag}`,
    profileStreetNumber: HEBREW_SUFFIX_NUMBER,
    contactPhone: '050-1234567',
    biography: `bio ${tag}`,
    avatarUrl: `https://cdn.kc.test/avatars/${tag}.jpg`,
  };
}

/** Field-by-field comparison, so a failure names the field that drifted. */
function assertProfile(actual: EditableProfile, expected: EditableProfile, what: string): void {
  for (const key of Object.keys(expected) as Array<keyof EditableProfile>) {
    assertEqual(actual[key], expected[key], `${what} — ${key}`);
  }
}

/** Runs a write that the contract allows to either reject or silently do nothing. */
async function attempt(write: Promise<unknown>): Promise<void> {
  await write.catch(() => undefined);
}

const fullEditRoundTrips: ContractCase<Ctx> = {
  name: 'edit profile: every field written in one edit reads back unchanged (FR-PROFILE-007 AC1)',
  async run(ctx) {
    const me = await ctx.newActor();
    const profile = fullProfile(ctx.cities[0], 'full');
    await me.users.updateEditableProfile(me.userId, profile);
    assertProfile(await me.users.getEditableProfile(me.userId), profile, 'after a full edit');
  },
};

const partialPatchSemantics: ContractCase<Ctx> = {
  name: 'edit profile: an omitted field is kept and null clears a nullable one (FR-PROFILE-007 AC1)',
  async run(ctx) {
    const me = await ctx.newActor();
    const profile = fullProfile(ctx.cities[0], 'patch');
    await me.users.updateEditableProfile(me.userId, profile);
    await me.users.updateEditableProfile(me.userId, { displayName: 'renamed', biography: null, contactPhone: null });
    const expected = { ...profile, displayName: 'renamed', biography: null, contactPhone: null };
    assertProfile(await me.users.getEditableProfile(me.userId), expected, 'after a partial edit');
  },
};

const invalidPatchChangesNothing: ContractCase<Ctx> = {
  name: 'edit profile: an edit with one invalid field changes no field (FR-PROFILE-007 AC4)',
  async run(ctx) {
    const me = await ctx.newActor();
    const profile = fullProfile(ctx.cities[0], 'atomic');
    await me.users.updateEditableProfile(me.userId, profile);
    const tooLongBio = 'b'.repeat(PROFILE_FIELD_LIMITS.biographyMax + 1);
    await assertRejects(
      me.users.updateEditableProfile(me.userId, { displayName: 'new name', biography: tooLongBio }),
      'an edit with a too-long biography',
    );
    assertProfile(await me.users.getEditableProfile(me.userId), profile, 'after the refused edit');
  },
};

const textLimitsHold: ContractCase<Ctx> = {
  name: 'edit profile: name 1–50, biography ≤ 200 without links, phone 1–20 after trim (FR-PROFILE-007 AC1, AC3)',
  async run(ctx) {
    const me = await ctx.newActor();
    const { displayNameMax, biographyMax, contactPhoneMax } = PROFILE_FIELD_LIMITS;
    await me.users.updateEditableProfile(me.userId, {
      displayName: 'n'.repeat(displayNameMax),
      biography: 'b'.repeat(biographyMax),
      contactPhone: '1'.repeat(contactPhoneMax),
    });
    const write = (patch: Parameters<ProfileEditing['updateEditableProfile']>[1]) =>
      me.users.updateEditableProfile(me.userId, patch);
    await assertRejects(write({ displayName: '' }), 'an empty display name');
    await assertRejects(write({ displayName: 'n'.repeat(displayNameMax + 1) }), 'a 51-character display name');
    await assertRejects(me.users.setBiography(me.userId, 'b'.repeat(biographyMax + 1)), 'a 201-character biography');
    await assertRejects(me.users.setBiography(me.userId, 'see www.example.com'), 'a biography with a link');
    await assertRejects(me.users.setContactPhone(me.userId, '   '), 'a blank contact phone');
    await assertRejects(me.users.setContactPhone(me.userId, '1'.repeat(contactPhoneMax + 1)), 'a 21-character phone');
    const kept = await me.users.getEditableProfile(me.userId);
    assertEqual(kept.displayName, 'n'.repeat(displayNameMax), 'the 50-character name is kept');
    assertEqual(kept.biography, 'b'.repeat(biographyMax), 'the 200-character biography is kept');
    assertEqual(kept.contactPhone, '1'.repeat(contactPhoneMax), 'the 20-character phone is kept');
  },
};

const addressIsAPair: ContractCase<Ctx> = {
  name: 'address: street and number are set and cleared together; the number is digits plus one letter (FR-PROFILE-007 AC1)',
  async run(ctx) {
    const me = await ctx.newActor();
    await me.users.setProfileAddressLines(me.userId, 'Herzl', HEBREW_SUFFIX_NUMBER);
    await assertRejects(me.users.setProfileAddressLines(me.userId, 'Herzl', null), 'a street without a number');
    await assertRejects(me.users.setProfileAddressLines(me.userId, null, '12'), 'a number without a street');
    await assertRejects(me.users.setProfileAddressLines(me.userId, 'Herzl', '12-A'), 'a number with punctuation');
    await assertRejects(me.users.setProfileAddressLines(me.userId, 'Herzl', '12AB'), 'a two-letter suffix');
    const tooLongStreet = 's'.repeat(PROFILE_FIELD_LIMITS.streetMax + 1);
    await assertRejects(me.users.setProfileAddressLines(me.userId, tooLongStreet, '1'), 'an 81-character street');
    const kept = await me.users.getEditableProfile(me.userId);
    assertEqual(kept.profileStreet, 'Herzl', 'street after the refused writes');
    assertEqual(kept.profileStreetNumber, HEBREW_SUFFIX_NUMBER, 'number after the refused writes');
    await me.users.setProfileAddressLines(me.userId, null, null);
    const cleared = await me.users.getEditableProfile(me.userId);
    assertEqual(cleared.profileStreet, null, 'street after clearing');
    assertEqual(cleared.profileStreetNumber, null, 'number after clearing');
  },
};

const unknownCityRefused: ContractCase<Ctx> = {
  name: 'edit profile: a city outside the city list is refused (FR-PROFILE-007 AC1)',
  async run(ctx) {
    const me = await ctx.newActor();
    const [city] = ctx.cities;
    await me.users.updateEditableProfile(me.userId, { city: city.id, cityName: city.name });
    await assertRejects(
      me.users.updateEditableProfile(me.userId, { city: 'no-such-city', cityName: 'nowhere' }),
      'an unknown city id',
    );
    assertEqual((await me.users.getEditableProfile(me.userId)).city, city.id, 'city after the refused edit');
  },
};

const singleFieldSetters: ContractCase<Ctx> = {
  name: 'setters: avatar, biography and phone each write and clear only their own field (FR-AUTH-011, FR-PROFILE-007)',
  async run(ctx) {
    const me = await ctx.newActor();
    const profile = fullProfile(ctx.cities[1], 'setters');
    await me.users.updateEditableProfile(me.userId, profile);
    await me.users.setAvatar(me.userId, 'https://cdn.kc.test/avatars/new.jpg');
    await me.users.setBiography(me.userId, 'new bio');
    await me.users.setContactPhone(me.userId, '03-7654321');
    const updated = { ...profile, avatarUrl: 'https://cdn.kc.test/avatars/new.jpg', biography: 'new bio', contactPhone: '03-7654321' };
    assertProfile(await me.users.getEditableProfile(me.userId), updated, 'after the setters');
    await me.users.setAvatar(me.userId, null);
    await me.users.setBiography(me.userId, null);
    await me.users.setContactPhone(me.userId, null);
    const cleared = { ...profile, avatarUrl: null, biography: null, contactPhone: null };
    assertProfile(await me.users.getEditableProfile(me.userId), cleared, 'after clearing through the setters');
  },
};

const othersProfileIsReadOnly: ContractCase<Ctx> = {
  name: "ownership: a member's writes to another member's profile change nothing",
  async run(ctx) {
    const owner = await ctx.newActor();
    const intruder = await ctx.newActor();
    const profile = fullProfile(ctx.cities[0], 'owner');
    await owner.users.updateEditableProfile(owner.userId, profile);
    await attempt(intruder.users.updateEditableProfile(owner.userId, { displayName: 'hijacked', biography: null }));
    await attempt(intruder.users.setAvatar(owner.userId, null));
    await attempt(intruder.users.setContactPhone(owner.userId, '000'));
    await attempt(intruder.users.setProfileAddressLines(owner.userId, null, null));
    await attempt(intruder.users.markBasicInfoSkipped(owner.userId));
    assertProfile(await owner.users.getEditableProfile(owner.userId), profile, "the owner's profile");
    assertEqual((await owner.users.getOnboardingBootstrap(owner.userId)).basicInfoSkipped, false, 'skip flag');
  },
};

const othersPrivateFieldsHidden: ContractCase<Ctx> = {
  name: "ownership: reading another member's editable profile never returns a phone or address",
  async run(ctx) {
    const owner = await ctx.newActor();
    const viewer = await ctx.newActor();
    await owner.users.updateEditableProfile(owner.userId, fullProfile(ctx.cities[0], 'owner'));
    // The viewer's own phone and address differ from the owner's, so neither can pass for the other.
    const viewerProfile = { ...fullProfile(ctx.cities[1], 'viewer'), contactPhone: '03-1111111', profileStreetNumber: '7' };
    await viewer.users.updateEditableProfile(viewer.userId, viewerProfile);
    const seen = await viewer.users.getEditableProfile(owner.userId).catch(() => null);
    if (seen === null) return; // refusing the read outright also keeps the fields private
    assertEqual(seen.contactPhone, null, "the owner's contact phone");
    assertEqual(seen.profileStreet, null, "the owner's street");
    assertEqual(seen.profileStreetNumber, null, "the owner's street number");
  },
};

const unknownProfileThrows: ContractCase<Ctx> = {
  name: 'edit profile: reading a profile that does not exist throws',
  async run(ctx) {
    const me = await ctx.newActor();
    await assertRejects(
      me.users.getEditableProfile('00000000-0000-4000-8000-000000000000'),
      'getEditableProfile of an unknown user',
    );
  },
};

/** The profile-editing cases, in a stable order. */
export function profileEditingContract(): ReadonlyArray<ContractCase<Ctx>> {
  return [
    fullEditRoundTrips,
    partialPatchSemantics,
    invalidPatchChangesNothing,
    textLimitsHold,
    addressIsAPair,
    unknownCityRefused,
    singleFieldSetters,
    othersProfileIsReadOnly,
    othersPrivateFieldsHidden,
    unknownProfileThrows,
    ...onboardingProgressCases(),
  ];
}
