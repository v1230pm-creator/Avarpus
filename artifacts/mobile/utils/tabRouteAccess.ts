export type TabSegments = readonly (string | undefined)[];

function isChatRoomRoute(segments: TabSegments): boolean {
  return segments[1] === 'customers' && segments[2] === 'chat';
}

function isCompactAccountRoute(segments: TabSegments): boolean {
  return (
    segments[1] === 'more' &&
    (segments[2] === undefined ||
      segments[2] === 'profile' ||
      segments[2] === 'notifications')
  );
}

export function canCustomerAccessTabsRoute(segments: TabSegments): boolean {
  return segments[1] === undefined || isChatRoomRoute(segments) || isCompactAccountRoute(segments);
}

export function canPortalAccessTabsRoute(segments: TabSegments): boolean {
  return (
    segments[1] === undefined ||
    segments[1] === 'repairs' ||
    isChatRoomRoute(segments) ||
    isCompactAccountRoute(segments)
  );
}