# Avarpus SIM verification bridge

The Android app never claims that a mobile number is verified. It opens the
user-visible SMS composer with this exact message:

```text
AVARPUS VERIFY AVP-<64 lowercase hexadecimal characters>
```

Your controlled SMS receiver must forward each incoming message to:

```text
POST /api/auth/sms-verification
Content-Type: application/json
```

```json
{
  "senderNumber": "+919876543210",
  "message": "AVARPUS VERIFY AVP-...",
  "receivedAt": "2026-08-24T12:34:56.000Z",
  "gatewayMessageId": "provider-message-id",
  "signature": "<lowercase SHA-256 HMAC>"
}
```

## Signature

Set the same high-entropy `SMS_BRIDGE_SHARED_SECRET` in the bridge and the API
service secret store. Sign the following UTF-8 payload with HMAC-SHA-256 and
send the lowercase hexadecimal result in `signature`:

```text
<senderNumber>\n<message>\n<receivedAt>\n<gatewayMessageId>
```

The API rejects unsigned, stale, duplicate, malformed, expired, replayed, and
sender-mismatched messages. It only stores challenge hashes and never stores
the raw SIM challenge.

## Android configuration

Set a public `EXPO_PUBLIC_SMS_VERIFICATION_NUMBER` build variable to the
dedicated receiver number in the format `+<countrycode><number>`. The mobile
app fails closed when this is absent. A custom native Android module named
`AvarpusDeviceKey` is additionally required to enable Keystore-backed device
keys; Expo Go intentionally does not emulate it.