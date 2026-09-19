import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts/legacy';
import { normalizeIndianPhone } from '@/hooks/useAvarpusContacts';

/**
 * Silent, permission-gated device-contact name lookup by phone number.
 *
 * Never prompts for contacts permission itself — it only reads contacts
 * when permission was already granted elsewhere (e.g. the "Select contact"
 * picker). This lets chat surfaces prefer the name the user saved for a
 * person in their phone over that person's Avarpus profile name, without
 * surprising anyone with an unexpected permission prompt.
 */
export function useDeviceContactNames() {
  const [byPhone, setByPhone] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const permission = await Contacts.getPermissionsAsync();
        if (!permission.granted) return;
        const result = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
        if (cancelled) return;
        const map = new Map<string, string>();
        result.data.forEach((contact) => {
          const name = contact.name?.trim();
          if (!name) return;
          (contact.phoneNumbers ?? []).forEach((entry) => {
            const phone = normalizeIndianPhone(entry.number ?? '');
            if (phone && !map.has(phone)) map.set(phone, name);
          });
        });
        setByPhone(map);
      } catch {
        // Silent: fall back to profile names if contacts can't be read.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => ({
      byPhone,
      /** Saved contact name for a mobile number, or the given fallback. */
      nameFor: (mobile: string | undefined | null, fallback: string) => {
        const phone = mobile ? normalizeIndianPhone(mobile) : null;
        return (phone && byPhone.get(phone)) || fallback;
      },
    }),
    [byPhone],
  );
}
