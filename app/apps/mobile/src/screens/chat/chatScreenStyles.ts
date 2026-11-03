// Styles for `app/chat/[id].tsx` — keeps screen file under architecture LOC cap.
import { makeUseStyles, typography, spacing, radius } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export const useChatConversationStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  messageList: { padding: spacing.base, gap: spacing.sm },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm,
  },
  input: {
    minHeight: 40, maxHeight: 100, backgroundColor: colors.background, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.body, color: colors.textPrimary,
    borderWidth: 1.5, borderColor: colors.border,
  },
  counter: { ...typography.caption, color: colors.textSecondary, alignSelf: 'flex-start', paddingHorizontal: spacing.sm },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: { width: 40, height: 40, borderRadius: radius.xl, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  typingHint: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xs,
    textAlign: rtlTextAlignStart,
  },
}));
