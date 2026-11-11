// Chat conversation screen — FR-CHAT-002, 003, 004, 005, 010, 011, 013, 016.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TouchableOpacity, KeyboardAvoidingView, Platform, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MESSAGE_MAX_CHARS } from '@kc/domain';
import { ChatError } from '@kc/application';
import { useTheme, Text, TextInput, iconSize } from '@kc/ui';
import { rtlTextAlignStart } from '../../src/lib/rtlLayout';
import { useChatStore, type OptimisticMessage } from '../../src/store/chatStore';
import { useAuthStore } from '../../src/store/authStore';
import { container } from '../../src/lib/container';
import { markNeedFreshThreadWith } from '../../src/lib/chatNavigationPrefs';
import { MessageBubble } from '../../src/components/MessageBubble';
import { ChatDaySeparator } from '../../src/components/chat/ChatDaySeparator';
import { buildChatThreadRowsNewestFirst, type ChatThreadListRow } from '../../src/lib/chatThreadListRows';
import { computeHandledIds } from '../../src/components/chat/system/handledIds';
import { AnchoredPostCard } from '../../src/components/chat/AnchoredPostCard';
import { ChatScreenOverlays } from '../../src/components/chat/ChatScreenOverlays';
import { useChatInit } from '../../src/components/useChatInit';
import { useChatSend } from '../../src/hooks/useChatSend';
import { useChatConversationStyles } from '../../src/screens/chat/chatScreenStyles';
import { usePushPermissionGate, registerCurrentDeviceIfPermitted } from '../../src/lib/notifications';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { EnablePushModal } from '../../src/components/EnablePushModal';
import { ChatNotFoundView } from '../../src/components/chat/ChatNotFoundView';
import { NotifyModal } from '../../src/components/NotifyModal';
import { ChatConversationHeader } from '../../src/components/chat/ChatConversationHeader';
import { useKeyboardVerticalOffset } from '../../src/lib/platform/useKeyboardVerticalOffset';
import { CHAT_CONVERSATION_HEADER_HEIGHT } from '../../src/lib/platform/formChromeHeights';
import { useChatTypingIndicator } from '../../src/hooks/useChatTypingIndicator';
import { useChatMessageReactions } from '../../src/hooks/useChatMessageReactions';
import { pickChatImage, uploadChatImageAndSend } from '../../src/services/chatMediaUpload';
import type { MessageReactionType } from '@kc/infrastructure-supabase';
import { webEnterToSend } from '../../src/components/chat/webEnterToSend';
import { firstParam } from '../../src/lib/postChatPrefillDecision';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const EMPTY_MESSAGES: OptimisticMessage[] = [];
const chatThreadKeyExtractor = (row: ChatThreadListRow) =>
  row.rowType === 'message' ? row.message.clientId : row.rowKey;

export default function ChatScreen() {
  const { id, prefill } = useLocalSearchParams<{ id: string; prefill?: string | string[] }>();
  const chatId = id!;
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useChatConversationStyles();
  const { colors } = useTheme();
  const userId = useAuthStore((s) => s.session?.userId)!;
  const keyboardOffset = useKeyboardVerticalOffset({
    headerHeight: CHAT_CONVERSATION_HEADER_HEIGHT,
  });

  const messages = useChatStore((s) => s.threads[chatId] ?? EMPTY_MESSAGES);
  const { chat, counterpart, status: chatStatus } = useChatInit(chatId, userId);
  const prefillText = firstParam(prefill);
  const [input, setInput] = useState(() => prefillText ?? '');
  const autoPrefillDedupeRef = useRef<string | undefined>(prefillText);

  useEffect(() => {
    const template = autoPrefillDedupeRef.current;
    if (!template) return;
    if (messages.length === 0) return;
    const recent = messages.length <= 50 ? messages : messages.slice(-50);
    const sent = recent.some((m) => m.senderId === userId && m.body === template);
    if (sent) setInput((cur) => (cur === template ? '' : cur));
    autoPrefillDedupeRef.current = undefined;
  }, [messages, userId]);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideConfirmOpen, setHideConfirmOpen] = useState(false);
  // TD-138: Alert.alert is a no-op on react-native-web — surface via NotifyModal.
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);
  const [hideBusy, setHideBusy] = useState(false);
  const { modalState, presentPrePrompt, handleAccept, handleDecline } = usePushPermissionGate();
  const send = useChatSend({ chatId, userId, input, setInput, presentPrePrompt, setNotify });
  const { peerTyping, notifyComposerChanged, notifyMessageSent } = useChatTypingIndicator(chatId, userId);

  // `send` is recreated each render (it closes over `input`); keep a stable
  // retry callback via a ref so memoized MessageBubbles don't re-render on every
  // composer keystroke.
  const sendRef = useRef(send);
  sendRef.current = send;
  const handleRetry = useCallback(
    (clientId: string, body: string) => void sendRef.current(clientId, body),
    [],
  );

  const unreadIncoming = useMemo(
    () => messages.some((m) => m.senderId !== userId && m.status !== 'read'),
    [messages, userId],
  );
  useEffect(() => {
    if (!unreadIncoming) return;
    void (async () => {
      await container.markChatRead.execute({ chatId, userId });
      useChatStore.getState().markChatLocallyRead(chatId);
    })();
  }, [unreadIncoming, chatId, userId]);

  const counter = input.length;
  const showCounter = counter >= 1900;
  // Audit §16.7 — trim for the disabled state so whitespace-only input doesn't
  // present an enabled "send" button (the underlying useChatSend already trims
  // and silently drops empty bodies, but the button shouldn't pretend to work).
  const sendDisabled = input.trim().length === 0 || counter > MESSAGE_MAX_CHARS;
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Precompute O(1) lookup of message ids handled by a later mod_action_taken
  // bubble (FR-MOD-010). Built once per messages render; O(1) per row.
  const handledIds = useMemo(() => computeHandledIds(reversedMessages), [reversedMessages]);
  const listRows = useMemo(() => buildChatThreadRowsNewestFirst(reversedMessages), [reversedMessages]);

  const reactionMessageIds = useMemo(
    () => messages.map((m) => m.messageId).filter((id): id is string => Boolean(id)),
    [messages],
  );
  const { byMessage, mine: myReactions, toggle: toggleReaction } = useChatMessageReactions(
    chatId,
    reactionMessageIds,
  );

  const handleReactionPick = useCallback(
    (messageId: string, reaction: MessageReactionType) => {
      void toggleReaction(messageId, reaction);
    },
    [toggleReaction],
  );

  const handleAttachImage = useCallback(async () => {
    const picked = await pickChatImage();
    if (!picked) return;
    try {
      await uploadChatImageAndSend(chatId, userId, picked.uri, async (payload) => {
        const server = await container.chatV2Repo.sendMediaMessage(chatId, payload);
        useChatStore.getState().appendOptimistic(chatId, {
          ...server,
          clientId: server.messageId,
        });
      });
    } catch {
      setNotify({ title: t('chat.errorTitle'), message: t('chat.mediaUploadFailed') });
    }
  }, [chatId, userId, t]);

  // Stable renderItem so the thread KcFlashList doesn't re-render every bubble on
  // each composer keystroke — deps change only on real data changes.
  const renderItem = useCallback<ListRenderItem<ChatThreadListRow>>(
    ({ item }) =>
      item.rowType === 'day' ? (
        <ChatDaySeparator anchorIso={item.anchorIso} />
      ) : (
        <MessageBubble
          m={item.message}
          mine={item.message.senderId === userId}
          onRetry={handleRetry}
          handledByLaterAction={handledIds.has(item.message.messageId)}
          reactionSummary={
            item.message.messageId ? byMessage[item.message.messageId] : undefined
          }
          myReaction={
            item.message.messageId ? myReactions[item.message.messageId] ?? null : null
          }
          onReactionPick={handleReactionPick}
        />
      ),
    [userId, handleRetry, handledIds, byMessage, myReactions, handleReactionPick],
  );

  const confirmHideFromInbox = async () => {
    setHideBusy(true);
    try {
      await container.hideChatFromInbox.execute({ chatId });
      if (counterpart.userId) markNeedFreshThreadWith(counterpart.userId);
      useChatStore.getState().stopThreadSub(chatId);
      await useChatStore.getState().refreshInbox(userId, container.chatRepo);
      setHideConfirmOpen(false);
      setHideBusy(false);
      router.back();
    } catch (err) {
      setHideBusy(false);
      const msg =
        err instanceof ChatError && err.code === 'support_thread_not_hideable'
          ? t('chat.hideErrorSupport')
          : t('chat.hideErrorGeneric');
      setNotify({ title: t('chat.errorTitle'), message: msg });
    }
  };

  if (chatStatus === 'not_found') return <ChatNotFoundView onBack={() => router.back()} />;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ChatConversationHeader
        title={counterpart.displayName ?? (chat?.isSupportThread ? t('chat.messaging.supportThreadTitle') : t('common.deletedUser'))}
        canOpenProfile={!counterpart.isDeleted && Boolean(counterpart.shareHandle)}
        shareHandle={counterpart.shareHandle ?? undefined}
        onOpenMenu={() => setMenuOpen(true)}
        peerUserId={counterpart.isDeleted ? null : counterpart.userId}
        peerVerificationLevel={counterpart.verificationLevel}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={keyboardOffset}
      >
        {chat ? (
          <AnchoredPostCard
            chatId={chatId}
            anchorPostId={chat.anchorPostId}
            viewerId={userId}
            counterpartId={chat.participantIds[0] === userId ? chat.participantIds[1] : chat.participantIds[0]}
          />
        ) : null}
        <KcFlashList
          data={listRows}
          inverted
          keyExtractor={chatThreadKeyExtractor}
          estimatedItemSize={72}
          contentContainerStyle={styles.messageList}
          renderItem={renderItem}
        />

        {peerTyping ? (
          <Text style={styles.typingHint}>{t('chat.typingIndicator')}</Text>
        ) : null}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => void handleAttachImage()}
            accessibilityLabel={t('chat.attachImage')}
          >
            <Ionicons name="image-outline" size={iconSize.xl} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sendBtn, sendDisabled && styles.sendBtnDisabled]} onPress={() => { notifyMessageSent(); void send(); }} disabled={sendDisabled}
            accessibilityRole="button" accessibilityLabel={t('chat.send')} testID="chat-send">
            <Ionicons name="send" size={iconSize.lg} color={colors.textInverse} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TextInput // brand-guard-allow: chat composer is a non-form input (spec 17 §4.1)
              style={styles.input}
              value={input}
              onChangeText={(text) => {
                setInput(text);
                notifyComposerChanged();
              }}
              placeholder={t('chat.inputPlaceholder')}
              placeholderTextColor={colors.textDisabled}
              textAlign={rtlTextAlignStart}
              multiline
              maxLength={MESSAGE_MAX_CHARS}
              onKeyPress={webEnterToSend(send, sendDisabled)}
            />
            {showCounter && <Text style={styles.counter}>{counter}/{MESSAGE_MAX_CHARS}</Text>}
          </View>
        </View>
      </KeyboardAvoidingView>

      <ChatScreenOverlays
        chatId={chatId}
        isSupportThread={chat?.isSupportThread}
        counterpartUserId={counterpart.isDeleted ? null : counterpart.userId}
        reportOpen={reportOpen}
        onReportClose={() => setReportOpen(false)}
        menuOpen={menuOpen}
        onMenuClose={() => setMenuOpen(false)}
        onReportFromMenu={() => { setMenuOpen(false); setReportOpen(true); }}
        hideConfirmOpen={hideConfirmOpen}
        hideBusy={hideBusy}
        onHideCancel={() => setHideConfirmOpen(false)}
        onOpenHideConfirm={() => setHideConfirmOpen(true)}
        onHideConfirm={confirmHideFromInbox}
      />
      <EnablePushModal
        visible={modalState.visible}
        trigger={modalState.trigger}
        onAccept={async () => {
          const status = await handleAccept();
          if (status === 'granted' && userId) {
            await registerCurrentDeviceIfPermitted(userId, { deviceRepo: container.deviceRepo });
          }
        }}
        onDecline={handleDecline}
      />
      <NotifyModal visible={notify !== null} title={notify?.title ?? ''} message={notify?.message ?? ''} onDismiss={() => setNotify(null)} />
    </SafeAreaView>
  );
}