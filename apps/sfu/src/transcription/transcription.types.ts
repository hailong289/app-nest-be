export interface TranscriptPayload {
  roomId: string;
  callId: string;
  speakerUserId: string;
  segmentId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  text: string;
  translatedText?: string;
  isFinal: boolean;
  startedAt: string;
  endedAt: string;
}

export interface StartCallTranscriptionInput {
  roomId: string;
  callId: string;
  userId: string;
  targetLanguage?: string;
  sourceLanguage?: string;
}

export interface StopCallTranscriptionInput {
  roomId: string;
  callId: string;
  userId: string;
}

export interface PcmSegment {
  pcm: Buffer;
  startedAt: Date;
  endedAt: Date;
}
