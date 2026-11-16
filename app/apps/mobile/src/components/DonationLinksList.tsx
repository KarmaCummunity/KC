// FR-DONATE-007/008/009 — community-curated NGO link list for a donation category.
// Used both on the new dynamic category screen and below Time/Money screens.
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  type DonationCategorySlug,
  type DonationLink,
  hasPermission,
  type AdminRole,
} from '@kc/domain';
import { iconSize, useTheme, Text } from '@kc/ui';
import { useAuthStore } from '../store/authStore';
import { AddDonationLinkModal } from './AddDonationLinkModal';
import { useDonationLinksListStyles } from './DonationLinksList.styles';
import { PrimaryButton } from './ui/Buttons';
import { DonationLinkRow } from './DonationLinkRow';
import { DonationLinkRowMenu } from './DonationLinkRowMenu';
import { useDonationLinkActions } from './useDonationLinkActions';
import { useAdminRoles } from '../hooks/useAdminRoles';
import { useDonationLinksListState } from './useDonationLinksListState';
import { filterAndSortLinks, type WorldLinksSort } from '../lib/worldLinksCatalog';

interface Props {
  readonly categorySlug: DonationCategorySlug;
  /** False when a parent already titles the list (a collapsible section, #1626). */
  readonly showTitle?: boolean;
  /** Optional search + sort applied to the loaded links (the world links screen, FR-DONATE-007). */
  readonly view?: { readonly query: string; readonly sort: WorldLinksSort };
}

export function DonationLinksList({ categorySlug, showTitle = true, view }: Readonly<Props>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useDonationLinksListStyles();
  const me = useAuthStore((s) => s.session?.userId ?? null);
  const { roles } = useAdminRoles();
  const canManuallyRemovePost = hasPermission(roles as readonly AdminRole[], 'reports.manual_remove_post');

  const { links, loading, errored, load, onAdded, onUpdated, onRemoved } =
    useDonationLinksListState(categorySlug);

  // Search and sort never touch the fetched array, so clearing the search restores the full list.
  const visibleLinks = useMemo(
    () => (view ? filterAndSortLinks(links, view) : links),
    [links, view],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<DonationLink | null>(null);
  const [webMenuLink, setWebMenuLink] = useState<DonationLink | null>(null);

  const onEditLink = useCallback((link: DonationLink) => {
    setEditingLink(link);
    setModalOpen(true);
  }, []);
  const openAddModal = useCallback(() => {
    setEditingLink(null);
    setModalOpen(true);
  }, []);
  const runNativeMenu = useDonationLinkActions({ me, isSuperAdmin: canManuallyRemovePost, onRemoved, onEdit: onEditLink });
  const onMenuPress = useCallback(
    (link: DonationLink) => {
      if (Platform.OS === 'web') setWebMenuLink(link);
      else runNativeMenu(link);
    },
    [runNativeMenu],
  );

  const Header = useMemo(
    () => (
      <View style={[styles.header, !showTitle && styles.headerUntitled]}>
        {showTitle ? <Text style={styles.headerTitle}>{t('donations.links.sectionTitle')}</Text> : null}
        <Pressable
          onPress={openAddModal}
          accessibilityRole="button"
          accessibilityLabel={t('donations.links.addButtonA11y')}
          hitSlop={6}
          style={({ pressed }) => [styles.plusBtn, pressed && styles.plusBtnPressed]}
        >
          <Ionicons name="add" size={iconSize.lg} color={colors.textInverse} />
        </Pressable>
      </View>
    ),
    [t, showTitle, openAddModal, styles, colors.textInverse],
  );

  const renderRow = useCallback(
    (link: DonationLink) => {
      const canRemove = link.submittedBy === me;
      return <DonationLinkRow link={link} canRemove={canRemove} onMenuPress={onMenuPress} />;
    },
    [me, onMenuPress],
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (errored) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyBody}>{t('donations.links.loadError')}</Text>
          <View style={styles.emptyCta}>
            <PrimaryButton testID="donation-links-retry" label={t('donations.links.retry')} size="md" onPress={() => void load()} />
          </View>
        </View>
      );
    }
    if (links.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons
            name="link-outline"
            size={36} // brand-guard-allow: empty-state glyph above the copy (spec 17 §4.2)
            color={colors.textDisabled}
          />
          <Text style={styles.emptyTitle}>{t('donations.links.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('donations.links.empty.body')}</Text>
          <View style={styles.emptyCta}>
            <PrimaryButton testID="donation-links-empty-cta" label={t('donations.links.empty.cta')} size="md" onPress={openAddModal} />
          </View>
        </View>
      );
    }
    if (visibleLinks.length === 0) {
      // Links exist but the search hid them all: say so instead of inviting a first link.
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('donations.worldLinks.noResultsTitle')}</Text>
          <Text style={styles.emptyBody}>{t('donations.worldLinks.noResultsBody')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.list}>
        {visibleLinks.map((link) => (
          <View key={link.id}>{renderRow(link)}</View>
        ))}
      </View>
    );
  };

  const webMenu = Platform.OS === 'web' && (
    <DonationLinkRowMenu
      visible={webMenuLink !== null}
      link={webMenuLink}
      me={me}
      isSuperAdmin={canManuallyRemovePost}
      onClose={() => setWebMenuLink(null)}
      onRemoved={(id) => {
        onRemoved(id);
        setWebMenuLink(null);
      }}
      onEdit={(lnk) => {
        setWebMenuLink(null);
        onEditLink(lnk);
      }}
    />
  );

  return (
    <View style={styles.container}>
      {Header}
      {renderBody()}
      <AddDonationLinkModal
        visible={modalOpen}
        categorySlug={categorySlug}
        editingLink={editingLink}
        onClose={() => {
          setModalOpen(false);
          setEditingLink(null);
        }}
        onAdded={onAdded}
        onUpdated={onUpdated}
      />
      {webMenu}
    </View>
  );
}
