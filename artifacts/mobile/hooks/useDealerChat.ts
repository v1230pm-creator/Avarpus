import { useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { chatContactsMatch, chatRoomsCreate } from '@workspace/api-client-react';

export interface DealerChatTarget {
  businessName: string;
  ownerUserId: string;
  ownerMobile: string;
}

/**
 * Opens (or creates) the direct chat room with the other shop's owner and
 * navigates into it. Reuses the ordinary chat system — dealer conversations
 * are normal direct rooms, not a separate messaging model.
 */
export function useDealerChat() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const openChat = async (target: DealerChatTarget | null | undefined, opts?: { transactionCode?: string }) => {
    if (!target?.ownerMobile || !target?.ownerUserId || busy) return;
    setBusy(true);
    try {
      const matchRes = await chatContactsMatch({ phone: target.ownerMobile });
      // Fail closed: only the exact owner account may be opened. A looser
      // phone-only fallback could start a chat with an unrelated user.
      const contact = matchRes.contacts.find((c) => c.userId === target.ownerUserId);
      if (!contact) {
        Alert.alert('Chat unavailable', `${target.businessName} could not be reached for chat right now.`);
        return;
      }
      const roomRes = await chatRoomsCreate({
        name: target.businessName,
        kind: 'direct',
        targetUserId: contact.userId,
        matchToken: contact.matchToken,
      } as any);
      router.push({
        pathname: '/(tabs)/customers/chat/[id]',
        params: {
          id: roomRes.room.id,
          name: target.businessName,
          ...(opts?.transactionCode ? { draft: `Regarding ${opts.transactionCode}: ` } : {}),
        },
      } as any);
    } catch (err: any) {
      Alert.alert('Chat unavailable', err?.data?.message ?? 'Could not open the chat. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return { openChat, busy };
}
