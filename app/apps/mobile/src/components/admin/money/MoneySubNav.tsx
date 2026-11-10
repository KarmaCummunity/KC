// FR-FIN-003 / FR-FIN-022 / FR-FIN-023 — secondary navigation of the finance area: ledger, accounts,
// donors and public display. Chips (not tabs) so it stays one horizontal row on phones.
import { ScrollView } from 'react-native';
import { router, type Href } from 'expo-router';
import { makeUseStyles, spacing } from '@kc/ui';
import { AdminFilterChip } from '../AdminFilterChip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export type MoneySection = 'ledger' | 'accounts' | 'donors' | 'visibility';

const ROUTES: Readonly<Record<MoneySection, Extract<Href, string>>> = {
  ledger: '/(admin)/money',
  accounts: '/(admin)/money/accounts',
  donors: '/(admin)/money/donors',
  visibility: '/(admin)/money/visibility',
};

const ORDER: readonly MoneySection[] = ['ledger', 'accounts', 'donors', 'visibility'];

export function MoneySubNav({ active }: { readonly active: MoneySection }) {
  const styles = useStyles();
  const nav = useLocaleBundle().admin.money.nav;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {ORDER.map((section) => (
        <AdminFilterChip
          key={section}
          label={nav[section]}
          active={active === section}
          onPress={() => { if (active !== section) router.replace(ROUTES[section]); }}
        />
      ))}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { paddingHorizontal: spacing.base, gap: spacing.sm, paddingBottom: spacing.sm },
}));
