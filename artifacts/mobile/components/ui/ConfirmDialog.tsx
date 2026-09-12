/**
 * App-wide destructive confirmation dialog.
 *
 * One look for every "are you sure?" moment: a round tinted icon, a short
 * question, "This action cannot be undone." under it, then stacked actions —
 * the primary destructive choice in red, secondary choices on a slate
 * surface, each with an uppercase label and a one-line description — and an
 * outlined CANCEL. Screens call `useConfirmDialog().confirm(...)` instead of
 * `Alert.alert`, so the dialog is owned once at the root and never depends on
 * the platform alert's styling.
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { AvarpusSpinner } from '@/components/ui/AvarpusSpinner';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export interface ConfirmAction {
  /** Rendered uppercase, e.g. "Delete for everyone". */
  label: string;
  /** One line under the label, e.g. "Remove for all participants". */
  description?: string;
  icon?: FeatherName;
  /** `destructive` = red gradient; `neutral` = slate surface. Defaults to destructive for the first action, neutral after. */
  tone?: 'destructive' | 'neutral';
  onPress: () => void | Promise<void>;
}

export interface ConfirmOptions {
  title: string;
  /** Optional context line shown under the title, before the caption. */
  message?: string;
  /**
   * Closing line under the message. Defaults to "This action cannot be
   * undone."; pass `null` for actions that are reversible.
   */
  caption?: string | null;
  icon?: FeatherName;
  actions: ConfirmAction[];
  cancelLabel?: string;
  onCancel?: () => void;
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmOptions) => void;
}

interface ConfirmDialogInternalValue {
  options: ConfirmOptions | null;
  busyIndex: number | null;
  onAction: (index: number) => void;
  onCancel: () => void;
  /** Newest mounted host; null = none, the root modal is the fallback. */
  topHost: string | null;
  /** Host that was on top when the open dialog was requested; null = root. */
  owner: string | null;
  registerHost: (id: string) => void;
  unregisterHost: (id: string) => void;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);
const ConfirmDialogInternalContext = createContext<ConfirmDialogInternalValue | null>(null);

const DEFAULT_MESSAGE = 'This action cannot be undone.';

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  // Native Modals cannot reliably stack from sibling subtrees (iOS refuses a
  // second presentation), so a screen that confirms from inside its own
  // Modal mounts a ConfirmDialogHost there; the host on top when confirm()
  // is called becomes the request's owner and draws the dialog inline. The
  // root Modal only draws requests made while no host was mounted.
  const [hosts, setHosts] = useState<string[]>([]);
  const hostsRef = useRef<string[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  // Every confirm() starts a new request. Async completions and host
  // teardown compare against this so a stale request can never close, block,
  // or replay a newer one.
  const requestRef = useRef<{ id: number; owner: string | null; options: ConfirmOptions | null; busy: boolean }>({
    id: 0, owner: null, options: null, busy: false,
  });

  const close = useCallback((requestId: number) => {
    if (requestRef.current.id !== requestId) return;
    requestRef.current = { ...requestRef.current, options: null, busy: false };
    setOptions(null);
    setBusyIndex(null);
    setOwner(null);
  }, []);

  const registerHost = useCallback((id: string) => {
    hostsRef.current = hostsRef.current.includes(id) ? hostsRef.current : [...hostsRef.current, id];
    setHosts(hostsRef.current);
  }, []);
  const unregisterHost = useCallback((id: string) => {
    hostsRef.current = hostsRef.current.filter((host) => host !== id);
    setHosts(hostsRef.current);
    // The owner going away (its Modal closed via Android back, a viewer
    // auto-advancing, a screen unmounting) ends the request as a cancel: an
    // invisible confirmation must never stay armed for a later remount.
    const current = requestRef.current;
    if (current.options && current.owner === id) {
      const onCancel = current.options.onCancel;
      close(current.id);
      if (!current.busy) onCancel?.();
    }
  }, [close]);

  const confirm = useCallback((next: ConfirmOptions) => {
    const hostList = hostsRef.current;
    const nextOwner = hostList.length > 0 ? hostList[hostList.length - 1] : null;
    requestRef.current = { id: requestRef.current.id + 1, owner: nextOwner, options: next, busy: false };
    setBusyIndex(null);
    setOwner(nextOwner);
    setOptions(next);
  }, []);

  const handleCancel = useCallback(() => {
    const current = requestRef.current;
    if (!current.options || current.busy) return;
    const onCancel = current.options.onCancel;
    close(current.id);
    onCancel?.();
  }, [close]);

  const handleAction = useCallback(async (index: number) => {
    const current = requestRef.current;
    if (!current.options || current.busy) return;
    const action = current.options.actions[index];
    if (!action) return;
    const requestId = current.id;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let result: void | Promise<void>;
    try {
      result = action.onPress();
    } catch (error) {
      close(requestId);
      throw error;
    }
    if (!result || typeof (result as Promise<void>).then !== 'function') {
      close(requestId);
      return;
    }
    // Keep the dialog up with a spinner while an async action runs so a slow
    // delete cannot be double-tapped. The caller owns its own error surface;
    // a rejection just releases the dialog and is reported for diagnostics.
    requestRef.current = { ...current, busy: true };
    setBusyIndex(index);
    try {
      await result;
    } catch (error) {
      if (__DEV__) console.warn('[ConfirmDialog] action failed', error);
    } finally {
      close(requestId);
    }
  }, [close]);

  const value = useMemo(() => ({ confirm }), [confirm]);
  const topHost = hosts.length > 0 ? hosts[hosts.length - 1] : null;
  const internal = useMemo<ConfirmDialogInternalValue>(() => ({
    options, busyIndex, onAction: handleAction, onCancel: handleCancel, topHost, owner, registerHost, unregisterHost,
  }), [busyIndex, handleAction, handleCancel, options, owner, registerHost, topHost, unregisterHost]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      <ConfirmDialogInternalContext.Provider value={internal}>
        {children}
        <ConfirmDialogView
          options={owner === null ? options : null}
          busyIndex={busyIndex}
          onAction={handleAction}
          onCancel={handleCancel}
        />
      </ConfirmDialogInternalContext.Provider>
    </ConfirmDialogContext.Provider>
  );
}

/**
 * Drop this as the LAST child inside any `<Modal>` whose content can trigger
 * `confirm()`. While mounted it takes over rendering the dialog inline (above
 * that modal's content) instead of the root Modal.
 */
export function ConfirmDialogHost() {
  const internal = useContext(ConfirmDialogInternalContext);
  const id = useId();
  const register = internal?.registerHost;
  const unregister = internal?.unregisterHost;
  useEffect(() => {
    if (!register || !unregister) return;
    register(id);
    return () => unregister(id);
  }, [id, register, unregister]);
  if (!internal || internal.owner !== id) return null;
  return (
    <ConfirmDialogView
      inline
      options={internal.options}
      busyIndex={internal.busyIndex}
      onAction={internal.onAction}
      onCancel={internal.onCancel}
    />
  );
}

export function useConfirmDialog(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error('useConfirmDialog must be used inside ConfirmDialogProvider');
  return ctx;
}

interface ConfirmDialogViewProps {
  options: ConfirmOptions | null;
  busyIndex: number | null;
  onAction: (index: number) => void;
  onCancel: () => void;
  /** Render as an absolute overlay instead of a native Modal (used inside other Modals). */
  inline?: boolean;
}

export function ConfirmDialogView({ options, busyIndex, onAction, onCancel, inline = false }: ConfirmDialogViewProps) {
  const colors = useColors();
  const dark = useColorScheme() === 'dark';
  const palette = dark
    ? {
        cardTop: '#27334A',
        cardBottom: '#161D2B',
        border: 'rgba(255,255,255,0.08)',
        title: '#F4F7FB',
        message: '#9AA6B8',
        neutralBg: '#2B3648',
        neutralBorder: 'rgba(255,255,255,0.10)',
        neutralText: '#F4F7FB',
        neutralSub: '#B4BECD',
        cancelBorder: 'rgba(255,255,255,0.16)',
        cancelText: '#4FC3F7',
      }
    : {
        cardTop: '#FFFFFF',
        cardBottom: '#F4F7FB',
        border: colors.border,
        title: colors.foreground,
        message: colors.mutedForeground,
        neutralBg: '#EAF0F7',
        neutralBorder: colors.border,
        neutralText: colors.foreground,
        neutralSub: colors.mutedForeground,
        cancelBorder: colors.border,
        cancelText: '#0891B2',
      };
  const visible = options !== null;

  const body = (
      <View
        style={[styles.backdrop, inline && styles.inlineBackdrop]}
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityLabel="Dismiss"
          testID="confirm-dialog-backdrop"
        />
        {options && (
          <LinearGradient
            colors={[palette.cardTop, palette.cardBottom]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[styles.card, { borderColor: palette.border }]}
            testID="confirm-dialog"
          >
            <View style={[styles.iconRing, { backgroundColor: 'rgba(255, 77, 79, 0.16)' }]}>
              <Feather name={options.icon ?? 'trash-2'} size={30} color={colors.destructive} />
            </View>
            <Text style={[styles.title, { color: palette.title }]} accessibilityRole="header">
              {options.title}
            </Text>
            {!!options.message && (
              <Text style={[styles.message, { color: palette.message }]}>{options.message}</Text>
            )}
            {options.caption !== null && (
              <Text style={[styles.message, styles.caption, { color: palette.message }]}>
                {options.caption ?? DEFAULT_MESSAGE}
              </Text>
            )}

            <View style={styles.actions}>
              {options.actions.map((action, index) => {
                const tone = action.tone ?? (index === 0 ? 'destructive' : 'neutral');
                const busy = busyIndex === index;
                const disabled = busyIndex !== null;
                const content = (
                  <View style={styles.actionRow}>
                    <View style={styles.actionIcon}>
                      {busy
                        ? <AvarpusSpinner size={20} color="#FFFFFF" />
                        : <Feather name={action.icon ?? 'trash-2'} size={20} color={tone === 'destructive' ? '#FFFFFF' : palette.neutralText} />}
                    </View>
                    <View style={styles.actionText}>
                      <Text
                        style={[styles.actionLabel, { color: tone === 'destructive' ? '#FFFFFF' : palette.neutralText }]}
                        numberOfLines={1}
                      >
                        {action.label.toUpperCase()}
                      </Text>
                      {!!action.description && (
                        <Text
                          style={[styles.actionSub, { color: tone === 'destructive' ? 'rgba(255,255,255,0.82)' : palette.neutralSub }]}
                          numberOfLines={2}
                        >
                          {action.description}
                        </Text>
                      )}
                    </View>
                  </View>
                );
                return (
                  <TouchableOpacity
                    key={`${action.label}-${index}`}
                    onPress={() => onAction(index)}
                    disabled={disabled}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    testID={`confirm-action-${index}`}
                    style={[styles.actionTouch, disabled && !busy && { opacity: 0.6 }]}
                  >
                    {tone === 'destructive' ? (
                      <LinearGradient
                        colors={['#FF5A5F', '#E63946']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.actionSurface}
                      >
                        {content}
                      </LinearGradient>
                    ) : (
                      <View style={[styles.actionSurface, { backgroundColor: palette.neutralBg, borderWidth: 1, borderColor: palette.neutralBorder }]}>
                        {content}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={onCancel}
                disabled={busyIndex !== null}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={options.cancelLabel ?? 'Cancel'}
                testID="confirm-cancel"
                style={[styles.cancel, { borderColor: palette.cancelBorder }]}
              >
                <Text style={[styles.cancelText, { color: palette.cancelText }]}>
                  {(options.cancelLabel ?? 'Cancel').toUpperCase()}
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        )}
      </View>
  );

  if (inline) return visible ? body : null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 10, 18, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  inlineBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 26,
    paddingBottom: 18,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 18 } },
      android: { elevation: 24 },
      default: {},
    }),
  },
  iconRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 8,
  },
  caption: {
    marginTop: 4,
  },
  actions: {
    width: '100%',
    gap: 10,
    marginTop: 22,
  },
  actionTouch: {
    width: '100%',
  },
  actionSurface: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 56,
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  actionIcon: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  actionSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    textAlign: 'center',
  },
  cancel: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
});
