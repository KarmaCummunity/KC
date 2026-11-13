// WhatsApp bot ops console (#939, M22 / L7): kill switch, overview, review queue of bot posts,
// outbound queue, consent, activity and templates for staff (`whatsapp.manage`, moderator+);
// the send limits and template approval for a super admin (`whatsapp.configure`).
import { RefreshControl, ScrollView, View } from 'react-native';
import { hasPermission, type AdminPermission, type AdminRole } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { useAdminRoles } from '../../hooks/useAdminRoles';
import { useLocaleBundle } from '../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin } from '../../hooks/useWhatsAppAdmin';
import { WhatsAppChannelPanel } from '../../components/admin/whatsapp/WhatsAppChannelPanel';
import { WhatsAppReviewPanel } from '../../components/admin/whatsapp/WhatsAppReviewPanel';
import { WhatsAppOutboundPanel } from '../../components/admin/whatsapp/WhatsAppOutboundPanel';
import { WhatsAppConsentPanel } from '../../components/admin/whatsapp/WhatsAppConsentPanel';
import { WhatsAppActivityPanels } from '../../components/admin/whatsapp/WhatsAppActivityPanels';
import { WhatsAppTemplatesPanel } from '../../components/admin/whatsapp/WhatsAppTemplatesPanel';
import { WhatsAppSendLimitsPanel } from '../../components/admin/whatsapp/WhatsAppSendLimitsPanel';

export { RouteErrorBoundary as ErrorBoundary } from '../../components/RouteErrorBoundary';

export function WhatsAppAdminScreen() {
  const styles = useStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const { roles, isLoading: rolesLoading } = useAdminRoles();
  const can = (perm: AdminPermission) => hasPermission(roles as readonly AdminRole[], perm);
  const invalidate = useInvalidateWhatsAppAdmin();

  if (rolesLoading) {
    return <View style={styles.center}><Text>{t.loading}</Text></View>;
  }
  if (!can('whatsapp.manage')) {
    return <View style={styles.center}><Text style={styles.forbidden}>{t.forbiddenTitle}</Text></View>;
  }
  const canConfigure = can('whatsapp.configure');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={invalidate} />}
    >
      <Text style={styles.title}>{t.title}</Text>
      <WhatsAppChannelPanel />
      <WhatsAppReviewPanel />
      <WhatsAppOutboundPanel />
      <WhatsAppConsentPanel />
      <WhatsAppActivityPanels />
      <WhatsAppTemplatesPanel canConfigure={canConfigure} />
      {canConfigure ? <WhatsAppSendLimitsPanel /> : null}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.base, paddingBottom: spacing['3xl'], gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forbidden: { color: colors.error, textAlign: 'center' },
  title: { fontSize: typography.h2.fontSize, ...typography.bold, color: colors.textPrimary, marginBottom: spacing.sm },
}));
