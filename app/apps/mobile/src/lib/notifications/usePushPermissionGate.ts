import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const STORAGE_KEY = 'push_permission_state';
const COOLDOWN_DAYS = 30;

export type PrePromptTrigger = 'first-message-sent' | 'first-post-published';

interface State {
  lastPromptAt: string | null;
  lastDecision: 'denied' | 'granted' | 'pending' | null;
  osPromptShown: boolean;
}

const initial: State = { lastPromptAt: null, lastDecision: null, osPromptShown: false };

async function load(): Promise<State> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as State) : initial;
}

async function save(state: State): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function withinCooldown(state: State): boolean {
  if (state.lastDecision !== 'denied' || !state.lastPromptAt) return false;
  const elapsedDays = (Date.now() - new Date(state.lastPromptAt).getTime()) / 86_400_000;
  return elapsedDays < COOLDOWN_DAYS;
}

/**
 * Pre-prompt gate. Caller wires it into the moment of a contextual trigger
 * (first chat sent, first post published) and renders a modal returned by
 * `presentPrePrompt`. On accept, the OS prompt is invoked.
 */
export function usePushPermissionGate() {
  const [modalState, setModalState] = useState<{ visible: boolean; trigger: PrePromptTrigger | null }>({
    visible: false, trigger: null,
  });

  const shouldPrompt = useCallback(async (): Promise<boolean> => {
    const state = await load();
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'granted') return false;
    if (perm.canAskAgain === false) return false;
    if (withinCooldown(state)) return false;
    return true;
  }, []);

  const presentPrePrompt = useCallback(async (trigger: PrePromptTrigger): Promise<boolean> => {
    if (!(await shouldPrompt())) return false;
    setModalState({ visible: true, trigger });
    return true;
  }, [shouldPrompt]);

  const handleAccept = useCallback(async (): Promise<'granted' | 'denied'> => {
    setModalState({ visible: false, trigger: null });
    const result = await Notifications.requestPermissionsAsync();
    const status = result.status === 'granted' ? 'granted' : 'denied';
    await save({ lastPromptAt: new Date().toISOString(), lastDecision: status, osPromptShown: true });
    return status;
  }, []);

  const handleDecline = useCallback(async (): Promise<void> => {
    setModalState({ visible: false, trigger: null });
    await save({ lastPromptAt: new Date().toISOString(), lastDecision: 'denied', osPromptShown: false });
  }, []);

  return { modalState, presentPrePrompt, handleAccept, handleDecline };
}
