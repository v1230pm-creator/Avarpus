import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts/legacy';
import { useChatContactsMatch } from '@workspace/api-client-react';
import type { ChatContact } from '@workspace/api-client-react';

const PHONE_BATCH_SIZE = 50;

export type DevicePhoneContact = {
  id: string;
  name: string;
  phone: string;
  imageUri?: string;
};

export type ContactDiscoveryStatus = 'idle' | 'loading' | 'empty' | 'denied' | 'error';

export function normalizeIndianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/**
 * Device-contact discovery + privacy-safe exact matching against Avarpus
 * accounts. Mirrors the inbox "Select contact" behaviour so other screens
 * (e.g. Forward) can offer the same picker.
 */
export function useAvarpusContacts() {
  const contactsMatch = useChatContactsMatch();
  const [status, setStatus] = useState<ContactDiscoveryStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deviceContacts, setDeviceContacts] = useState<DevicePhoneContact[]>([]);
  const [matchedContacts, setMatchedContacts] = useState<ChatContact[]>([]);
  const [loaded, setLoaded] = useState(false);

  const matchPhones = useCallback(async (phones: string[]) => {
    if (!phones.length) {
      setStatus('empty');
      return [] as ChatContact[];
    }
    setStatus('loading');
    setError(null);
    try {
      const responses = await Promise.all(
        Array.from({ length: Math.ceil(phones.length / PHONE_BATCH_SIZE) }, (_, index) =>
          contactsMatch.mutateAsync({
            data: { phones: phones.slice(index * PHONE_BATCH_SIZE, (index + 1) * PHONE_BATCH_SIZE) },
          }),
        ),
      );
      const byUserId = new Map<string, ChatContact>();
      responses.flatMap((response) => response.contacts).forEach((contact) => byUserId.set(contact.userId, contact));
      const contacts = [...byUserId.values()];
      setMatchedContacts((previous) => {
        const merged = new Map(previous.map((contact) => [contact.userId, contact]));
        contacts.forEach((contact) => merged.set(contact.userId, contact));
        return [...merged.values()];
      });
      setStatus(contacts.length ? 'idle' : 'empty');
      return contacts;
    } catch (err: any) {
      setStatus('error');
      setError(err?.data?.message ?? err?.message ?? 'Could not check your contacts. Please try again.');
      return [] as ChatContact[];
    }
  }, [contactsMatch]);

  const discover = useCallback(async () => {
    if (Platform.OS === 'web') {
      setStatus('error');
      setError('Contact discovery is available in the mobile app. You can still search an exact phone number.');
      setLoaded(true);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const currentPermission = await Contacts.getPermissionsAsync();
      const permission = currentPermission.granted || !currentPermission.canAskAgain
        ? currentPermission
        : await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus('denied');
        setLoaded(true);
        return;
      }
      const result = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Image],
        sort: Contacts.SortTypes.FirstName,
      });
      const byPhone = new Map<string, DevicePhoneContact>();
      result.data.forEach((contact) => {
        (contact.phoneNumbers ?? []).forEach((entry, index) => {
          const phone = normalizeIndianPhone(entry.number ?? '');
          if (!phone || byPhone.has(phone)) return;
          byPhone.set(phone, {
            id: `${contact.id}-${index}`,
            name: contact.name?.trim() || entry.number || phone,
            phone,
            imageUri: contact.image?.uri,
          });
        });
      });
      const discovered = [...byPhone.values()];
      setDeviceContacts(discovered);
      setLoaded(true);
      await matchPhones(discovered.map((contact) => contact.phone));
    } catch (err: any) {
      setLoaded(true);
      setStatus('error');
      setError(err?.message ?? 'Could not read your contacts. Please try again.');
    }
  }, [matchPhones]);

  /** Exact 10-digit lookup; returns the matches (also merged into matchedContacts). */
  const lookupExact = useCallback(async (raw: string) => {
    const phone = normalizeIndianPhone(raw);
    if (!phone) {
      setStatus('error');
      setError('Enter a valid 10-digit mobile number.');
      return [] as ChatContact[];
    }
    return matchPhones([phone]);
  }, [matchPhones]);

  const deviceContactByPhone = useMemo(
    () => new Map(deviceContacts.map((contact) => [contact.phone, contact])),
    [deviceContacts],
  );
  const registeredPhones = useMemo(
    () => new Set(matchedContacts.map((contact) => normalizeIndianPhone(contact.mobile ?? '')).filter(Boolean)),
    [matchedContacts],
  );
  const inviteContacts = useMemo(
    () => deviceContacts.filter((contact) => !registeredPhones.has(contact.phone)),
    [deviceContacts, registeredPhones],
  );

  /** Prefer the device's saved name/photo over the account's display name. */
  const displayFor = useCallback(
    (contact: ChatContact) => {
      const device = deviceContactByPhone.get(normalizeIndianPhone(contact.mobile ?? '') ?? '');
      return { name: device?.name ?? contact.name, photo: device?.imageUri ?? contact.profilePhoto ?? undefined };
    },
    [deviceContactByPhone],
  );

  return {
    status,
    error,
    loaded,
    deviceContacts,
    matchedContacts,
    inviteContacts,
    discover,
    lookupExact,
    displayFor,
  };
}
