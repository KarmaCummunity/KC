import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { nestedStackGestureOptions } from '../../../../src/navigation/nestedStackGestureOptions';
import { topBarStackHeaderOptions } from '../../../../src/navigation/TopBarStackHeader';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function TimeVolunteerLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{ ...nestedStackGestureOptions,
        ...topBarStackHeaderOptions,
        headerBackTitle: t('general.back'),
      }}
    >
      <Stack.Screen name="index" options={{ headerTitle: t('donations.timeScreen.title') }} />
      <Stack.Screen name="handoffs" options={{ headerTitle: t('givingHandoff.myHandoffs') }} />
      <Stack.Screen name="my-shifts" options={{ headerTitle: t('timeVolunteer.myShiftsTitle') }} />
      <Stack.Screen name="support" options={{ headerTitle: t('donations.timeScreen.title') }} />
      <Stack.Screen
        name="opportunity/[opportunityId]"
        options={{ headerTitle: t('timeVolunteer.hubTitle') }}
      />
      <Stack.Screen name="organizer/index" options={{ headerTitle: t('timeVolunteer.organizerTitle') }} />
      <Stack.Screen
        name="organizer/[opportunityId]"
        options={{ headerTitle: t('timeVolunteer.organizerTitle') }}
      />
      <Stack.Screen name="shift/[shiftId]/volunteers" options={{ headerTitle: t('timeVolunteer.rosterTitle') }} />
    </Stack>
  );
}
