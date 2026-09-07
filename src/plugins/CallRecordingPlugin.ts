import { registerPlugin } from "@capacitor/core";

export type PermState = "granted" | "denied" | "prompt";

export interface CallLogEntry {
  number: string;
  duration: number;
  date: number;
  type: string; // OUTGOING, INCOMING, MISSED, REJECTED
}

export interface RecordingInfo {
  uri: string;
  name: string;
  size: number;
  duration: number;
  mimeType: string;
  dateModified: number;
  matchReason?: string; // "filename_match" | "timestamp_proximity" | "user_picked"
}

export interface CallRecordingPluginInterface {
  getRecentCalls(opts: {
    phoneNumber: string;
    afterTimestamp: number;
    limit?: number;
  }): Promise<{ calls: CallLogEntry[] }>;

  findRecordings(opts: {
    afterTimestamp: number;
    beforeTimestamp?: number;
    phoneNumber?: string;
  }): Promise<{ recordings: RecordingInfo[] }>;

  pickAudioFile(): Promise<{ recording: RecordingInfo | null }>;

  readFileAsBase64(opts: {
    uri: string;
  }): Promise<{ base64: string; mimeType: string; size: number }>;

  /** Opens the Android application settings screen for this app. */
  openAppSettings(): Promise<void>;

  checkPermissions(): Promise<{ callLog: PermState; audio: PermState }>;
  requestPermissions(): Promise<{ callLog: PermState; audio: PermState }>;
}

const CallRecordingPlugin = registerPlugin<CallRecordingPluginInterface>(
  "CallRecordingPlugin"
);

export default CallRecordingPlugin;
