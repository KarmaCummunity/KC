import { describe, it, expect } from 'vitest';
import { countLiterals } from './brandGuardRules';

// Pins each brand-guard rule (spec 17 §4/§6, D67, D87): what it counts, the
// boundary it leaves alone, and the `brand-guard-allow:` escape hatch.

describe('countLiterals — colour, type, radius, spacing, sides', () => {
  it('counts quoted hex and rgb() colours, raw font sizes and font families', () => {
    const source = [
      "const a = { color: '#F97316', backgroundColor: \"#fff\" };",
      "const b = { borderColor: 'rgba(0, 0, 0, 0.5)', fontSize: 13, fontFamily: 'Courier' };",
    ].join('\n');
    expect(countLiterals(source)).toEqual({ colorLiteral: 3, fontSizeLiteral: 1, fontFamilyLiteral: 1 });
  });

  it('counts raw font weights, corner radii and spacing, but not zero', () => {
    const source = [
      "const a = { fontWeight: '800', borderRadius: 8, borderTopStartRadius: 12, borderRadius: 0 };",
      'const b = { padding: 10, marginHorizontal: -4, gap: 6, margin: 0, paddingTop: insets.top };',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ fontWeightLiteral: 1, radiusLiteral: 2, spacingLiteral: 3 });
  });

  it('counts physical sides that do not mirror between RTL and LTR', () => {
    const source = [
      "const a = { textAlign: 'right', borderLeftWidth: 1, borderTopRightRadius: radius.md };",
      "const b = { textAlign: 'center', borderStartWidth: 1, paddingEnd: spacing.sm };",
      '<Input textAlign="right" />',
      '<Input textAlign={rtlTextAlignStart} />',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ physicalSide: 4 });
  });

  it('ignores tokens, hashtags, issue numbers and allowed lines', () => {
    const source = [
      'const a = { color: colors.primary, fontSize: typography.body.fontSize };',
      'const b = { ...typography.bold, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs };',
      "const tag = '#giving'; // see #123",
      "const google = '#4285F4'; // brand-guard-allow: Google sign-in mark",
    ].join('\n');
    expect(countLiterals(source)).toEqual({});
  });
});

describe('countLiterals — iconSizeLiteral (spec 17 §4.2)', () => {
  it('counts numeric Ionicons sizes, on one line, across lines and inside ternaries', () => {
    const source = [
      '<Ionicons name="close" size={18} color={colors.textPrimary} />',
      '<Ionicons',
      '  name="chevron-back"',
      '  onPress={() => (open ? close() : null)}',
      '  size={22}',
      '/>',
      '<Ionicons name={icon} size={active ? 28 : iconSize.lg} />',
    ].join('\n');
    // The chevron is also a directional glyph on a raw tag (spec 17 §4.2).
    expect(countLiterals(source)).toEqual({ iconSizeLiteral: 3, unmirroredDirectionalIcon: 1 });
  });

  it('ignores tokens, constants and the size prop of other components', () => {
    const source = [
      '<Ionicons name="close" size={iconSize.md} color={colors.textPrimary} />',
      '<Ionicons name="star" size={ICON_SIZE} />',
      '<ActivityIndicator size="large" />',
      '<AvatarInitials size={48} name={name} />',
      '<Ionicons name="heart" />',
    ].join('\n');
    expect(countLiterals(source)).toEqual({});
  });

  it('skips a size on a line carrying the allow-marker', () => {
    const source = [
      '<Ionicons',
      '  name="gift"',
      '  size={72} // brand-guard-allow: empty-state illustration',
      '/>',
      '<Ionicons name="gift" size={56} />',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ iconSizeLiteral: 1 });
  });
});

describe('countLiterals — zIndexLiteral and shadowLiteral', () => {
  it('counts raw z-indexes, but not zero or tokens', () => {
    const source = [
      'const a = { zIndex: 2, position: "absolute" };',
      'const b = { zIndex: 9999 };',
      'const c = { zIndex: 0 };',
      'const d = { zIndex: zIndex.overlay };',
      'const e = { zIndex: 20 }; // brand-guard-allow: map callout above native layer',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ zIndexLiteral: 2 });
  });

  it('counts one finding per shadow property holding a non-zero number', () => {
    const source = [
      'const a = { shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0 : 0.06, shadowRadius: 10 };',
      'const b = { elevation: isDark ? 2 : 4, shadowOffset: { width: 0, height: -2 } };',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ shadowLiteral: 5 });
  });

  it('ignores switched-off shadows, preset values and allowed lines', () => {
    const source = [
      'const a = { shadowOpacity: 0, elevation: 0, shadowOffset: { width: 0, height: 0 } };',
      'const b = { shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity, elevation: shadow.card.elevation };',
      'const c = { ...shadow.glow, shadowColor: colors.primary };',
      'const d = { elevation: 3 }; // brand-guard-allow: native map marker',
    ].join('\n');
    expect(countLiterals(source)).toEqual({});
  });
});

describe('countLiterals — rawTextInput and rawModal (spec 17 §4.1)', () => {
  const source = [
    "import { Modal, Pressable } from 'react-native';",
    '<TextInput value={draft} onChangeText={setDraft} />',
    '<Modal visible={open} transparent>',
    '<ModalHeader title={title} />',
    '<TextInputLabel />',
  ].join('\n');

  it('counts raw inputs and modals in screens and feature components', () => {
    expect(countLiterals(source, 'src/components/ReportChatModal.tsx')).toEqual({ rawTextInput: 1, rawModal: 1 });
  });

  it('leaves the kit wrappers in components/ui alone', () => {
    expect(countLiterals(source, 'src/components/ui/TextField.tsx')).toEqual({});
  });

  it('skips a non-form input carrying the allow-marker', () => {
    const composer = '<TextInput // brand-guard-allow: chat composer, not a form field';
    expect(countLiterals(composer, 'app/chat/[id].tsx')).toEqual({});
  });

  it('counts an aliased React Native Modal imported across lines', () => {
    const aliased = ['import {', '  Modal as NativeModal,', '  View,', "} from 'react-native';", '<NativeModal visible />'];
    expect(countLiterals(aliased.join('\n'), 'src/components/Sheet.tsx')).toEqual({ rawModal: 1 });
  });

  it('does not count the kit Modal, which is not imported from react-native', () => {
    const kit = ["import { Modal } from '../components/ui';", '<Modal visible={open} onDismiss={close} title={title} />'];
    expect(countLiterals(kit.join('\n'), 'src/components/ReportChatModal.tsx')).toEqual({});
  });
});

describe('countLiterals — adHocChip (spec 17 §4.1)', () => {
  it('counts the base style of a hand-rolled chip, on its own line or inline', () => {
    const source = [
      'const useStyles = makeUseStyles(({ colors }) => ({',
      '  chip: {',
      '  chipActive: { backgroundColor: colors.primary },',
      '}));',
      "const s = StyleSheet.create({ row: { flex: 1 }, 'chip': { flex: 1 } });",
    ].join('\n');
    expect(countLiterals(source, 'app/(admin)/users/index.tsx')).toEqual({ adHocChip: 2 });
  });

  it('ignores chip variants, chip containers, locale keys, pills, plain objects and the kit', () => {
    const source = [
      'chips: { flexDirection: rowDirectionStart },',
      'chipRow: { gap: spacing.sm },',
      'chipText: { ...typography.caption },',
      "chips: { all: 'All' },",
      'pill: { borderRadius: radius.full },',
      'const chip = { bg: colors.infoLight };',
      '<Chip label={label} onPress={toggle} />',
    ].join('\n');
    expect(countLiterals(source, 'src/components/search/SearchChip.tsx')).toEqual({});
    expect(countLiterals('  chip: {', 'src/components/ui/chipStyles.ts')).toEqual({});
  });
});

describe('countLiterals — directional icons (spec 17 §4.2, FR-RESP-006 AC18)', () => {
  it('counts a directional Ionicons glyph, across lines and in braces, but not through MirroredIcon', () => {
    const source = [
      '<Ionicons name="chevron-back" size={iconSize.md} />',
      "<Ionicons\n  name={'arrow-forward'}\n  size={iconSize.md}\n/>",
      '<Ionicons name="caret-forward-outline" size={iconSize.sm} />',
      '<MirroredIcon name="chevron-forward" size={iconSize.md} />',
      '<Ionicons name={useDirectionalBackIcon()} size={iconSize.xl} />',
    ].join('\n');
    expect(countLiterals(source)).toEqual({ unmirroredDirectionalIcon: 3 });
  });

  it('leaves non-directional and vertical glyphs and allowed lines alone', () => {
    const source = [
      '<Ionicons name="search" size={iconSize.md} />',
      '<Ionicons name="chevron-down" size={iconSize.md} />',
      '<Ionicons name="arrow-up-circle" size={iconSize.md} />',
      '<Ionicons name="play-forward" size={iconSize.md} /> // brand-guard-allow: media control, never mirrors',
    ].join('\n');
    expect(countLiterals(source)).toEqual({});
  });
});

describe('countLiterals — rawPlatformCheck (spec 17 §4.4.2, KC#1960)', () => {
  it('counts raw Platform.OS and Platform.select checks', () => {
    const source = [
      "const isIos = Platform.OS === 'ios';",
      "const shadow = Platform.select({ ios: 'card', default: 'none' });",
    ].join('\n');
    expect(countLiterals(source)).toEqual({ rawPlatformCheck: 2 });
  });

  it('allows lines with brand-guard-allow marker', () => {
    const source = [
      "const isAndroid = Platform.OS === 'android'; // brand-guard-allow: native back handler",
      'const font = platformSelect({ ios: "System", android: "Roboto" });',
    ].join('\n');
    expect(countLiterals(source)).toEqual({});
  });
});
