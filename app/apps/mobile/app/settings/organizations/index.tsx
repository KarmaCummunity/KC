// FR-ORG-002 (G18) — "My organizations": the member's latest application to register an
// organization, the organizations they belong to (tap opens the members screen), and the way to
// register one. An organization's members publish its events in the time world (D31).
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isOrgApplicationOpen, type MyOrganization, type MyOrgApplication } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { Card, PrimaryButton, Screen } from '../../../src/components/ui';
import { SettingsScreenRow } from '../../../src/components/SettingsScreenRow';
import { useShellStackScreenOptions } from '../../../src/navigation/shellStackScreenOptions';
import {
  MY_ORG_APPLICATION_QUERY_KEY,
  MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY,
  organizationUseCases,
} from '../../../src/services/organizationsComposition';
import { webTextRtl, webViewRtl } from '../../../src/lib/webRtlStyle';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MyOrganizationsScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const application = useQuery({
    queryKey: MY_ORG_APPLICATION_QUERY_KEY,
    queryFn: () => organizationUseCases.getMyApplication().execute(),
  });
  const organizations = useQuery({
    queryKey: MY_ORGANIZATIONS_WITH_ROLES_QUERY_KEY,
    queryFn: () => organizationUseCases.listMine().execute(),
  });

  // One open application at a time (0730): the register button waits while one is pending.
  const canRegister = !(application.data && isOrgApplicationOpen(application.data.status));
  const loading = application.isLoading || organizations.isLoading;

  return (
    <>
      <Stack.Screen options={{ ...shellStackScreenOptions, headerTitle: t('organizations.title') }} />
      <Screen>
        <View style={[styles.body, webViewRtl]} testID="my-organizations-screen">
          <Text style={[styles.intro, webTextRtl]}>{t('organizations.intro')}</Text>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
          {application.data ? <ApplicationCard application={application.data} /> : null}
          <OrganizationList
            organizations={organizations.data ?? []}
            loading={loading}
            onOpen={(org) => router.push({ pathname: '/settings/organizations/[orgId]', params: { orgId: org.orgId } })}
          />
          {/* The member's recurring events (FR-POST-024): pause, change times, cancel a date, end. */}
          <SettingsScreenRow
            testID="my-organizations-series"
            icon="repeat-outline"
            label={t('postSeries.mine')}
            onPress={() => router.push('/(tabs)/donations/time/series')}
          />
          {canRegister ? (
            <PrimaryButton
              testID="my-organizations-register"
              label={t('organizations.registerCta')}
              icon="add-circle-outline"
              fullWidth
              onPress={() => router.push('/settings/organizations/register')}
            />
          ) : null}
        </View>
      </Screen>
    </>
  );
}

/** The latest application's state; a rejection shows the reviewer's note and when to retry. */
function ApplicationCard({ application }: { readonly application: MyOrgApplication }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const name = application.orgName;
  return (
    <Card padding="base" testID={`org-application-${application.status}`}>
      <Text style={[styles.cardTitle, webTextRtl]}>{t(`organizations.application.${application.status}Title`, { name })}</Text>
      {application.status === 'pending' ? (
        <Text style={[styles.meta, webTextRtl]}>{t('organizations.application.pendingBody')}</Text>
      ) : null}
      {application.status === 'rejected' && application.reviewNote ? (
        <Text style={[styles.meta, webTextRtl]}>{t('organizations.application.rejectedNote', { note: application.reviewNote })}</Text>
      ) : null}
      {application.status === 'rejected' ? (
        <Text style={[styles.meta, webTextRtl]}>{t('organizations.application.resubmitHint')}</Text>
      ) : null}
    </Card>
  );
}

function OrganizationList(props: {
  readonly organizations: readonly MyOrganization[];
  readonly loading: boolean;
  readonly onOpen: (org: MyOrganization) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  if (props.organizations.length === 0) {
    return props.loading ? null : <Text style={[styles.meta, webTextRtl]}>{t('organizations.empty')}</Text>;
  }
  return (
    <View style={styles.list}>
      {props.organizations.map((org) => (
        <SettingsScreenRow
          key={org.orgId}
          testID={`my-organization-${org.orgId}`}
          label={`${org.name} · ${t(`organizations.roles.${org.role}`)}`}
          icon="people-outline"
          onPress={() => props.onOpen(org)}
        />
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary },
  cardTitle: { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  list: { borderRadius: radius.md, overflow: 'hidden' as const },
}));
