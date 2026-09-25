/**
 * Absolute URL for a server entity path (`/objects/…`) served by the API's
 * authenticated storage route. Image components fetch this directly, so it
 * carries the API domain rather than relying on the API client's base URL.
 */
export function storageUrlFor(objectPath: string): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/storage${objectPath}`;
}
