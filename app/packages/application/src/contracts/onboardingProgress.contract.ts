// Onboarding progress cases of the profile-editing contract (G39, FSM wave 3b). Mapped to
// docs/spec/requirements/01_auth_and_onboarding.md FR-AUTH-007 AC2 (cold-start bootstrap),
// FR-AUTH-010 (basic info and skip), FR-AUTH-012 (finish) and machine `onboarding`
// (@kc/domain `onboardingMachine`, SQL `0698_fsm_onboarding.sql`): a member moves forward only,
// and leaves step 1 only with display name, city and date of birth on file.

import type { ContractCase } from './types';
import type { ProfileEditingContractContext } from './profileEditing.contract';
import { assertEqual, assertRejectsWithCode, assertTrue } from './assert';

type Ctx = ProfileEditingContractContext;

/** An adult date of birth, so the 18+ rule of `setDateOfBirth` never interferes. */
const ADULT_DATE_OF_BIRTH = '1990-05-15';

const onboardingRoundTrip: ContractCase<Ctx> = {
  name: 'onboarding: skip, basic info and state read back through the bootstrap (FR-AUTH-007 AC2, FR-AUTH-010 AC3)',
  async run(ctx) {
    const me = await ctx.newActor();
    await me.users.markBasicInfoSkipped(me.userId);
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).basicInfoSkipped, true, 'skip flag after skipping');
    await me.users.clearBasicInfoSkipped(me.userId);
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).basicInfoSkipped, false, 'skip flag after clearing');
    await me.users.markBasicInfoSkipped(me.userId);
    const [, city] = ctx.cities;
    await me.users.setBasicInfo(me.userId, { displayName: 'basic info', city: city.id });
    await me.users.setDateOfBirth(ADULT_DATE_OF_BIRTH);
    const bootstrap = await me.users.getOnboardingBootstrap(me.userId);
    assertEqual(bootstrap.basicInfoSkipped, false, 'saving basic info clears the skip flag');
    const profile = await me.users.getEditableProfile(me.userId);
    assertTrue(profile.displayName === 'basic info' && profile.city === city.id, 'basic info is stored');
    assertEqual(profile.cityName, city.name, 'city name is the name of the stored city');
    await me.users.setOnboardingState('pending_avatar');
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).state, 'pending_avatar', 'state after step 1');
    await me.users.setOnboardingState('pending_avatar');
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).state, 'pending_avatar', 'a repeated step is a no-op');
    await me.users.setOnboardingState('completed');
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).state, 'completed', 'state after the wizard');
  },
};

const onboardingMovesForwardOnly: ContractCase<Ctx> = {
  name: 'onboarding: step 1 is left only with its fields on file, and a member never moves back',
  async run(ctx) {
    const me = await ctx.newActor();
    const [city] = ctx.cities;
    await me.users.setBasicInfo(me.userId, { displayName: 'forward only', city: city.id });
    // Name and city are on file; the date of birth is not yet.
    await assertRejectsWithCode(
      me.users.setOnboardingState('pending_avatar'),
      'basic_info_missing',
      'leaving step 1 without a date of birth',
    );
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).state, 'pending_basic_info', 'the refused move changes nothing');

    await me.users.setDateOfBirth(ADULT_DATE_OF_BIRTH);
    await me.users.setOnboardingState('completed');
    await assertRejectsWithCode(
      me.users.setOnboardingState('pending_avatar'),
      'illegal_transition',
      'completed back to the photo step',
    );
    await assertRejectsWithCode(
      me.users.setOnboardingState('pending_basic_info'),
      'illegal_transition',
      'completed back to step 1 outside the developer reset',
    );
    assertEqual((await me.users.getOnboardingBootstrap(me.userId)).state, 'completed', 'the member stays completed');
  },
};

/** The onboarding cases, in a stable order. */
export function onboardingProgressCases(): ReadonlyArray<ContractCase<Ctx>> {
  return [onboardingRoundTrip, onboardingMovesForwardOnly];
}
