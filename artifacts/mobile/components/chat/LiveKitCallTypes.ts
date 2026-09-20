/**
 * Shared types for native and web LiveKit call components.
 */

export type CallMode = 'audio' | 'video';

export interface LiveKitCallProps {
  /** LiveKit server URL (wss://...) */
  serverUrl: string;
  /** Short-lived access token */
  token: string;
  /** audio-only or video call */
  mode: CallMode;
  /** Display name of the remote party */
  remoteName: string;
  /** Profile photo of the remote party (server entity path or URL), if any */
  remotePhoto?: string | null;
  /** Called when the user taps hang-up or the room disconnects */
  onHangup: () => void;
}
