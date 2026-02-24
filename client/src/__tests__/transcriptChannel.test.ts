import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import { window } from 'vscode';
import { getTranscriptChannel, appendTranscript, showTranscript } from '../transcriptChannel';

describe('transcriptChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTranscriptChannel', () => {
    it('creates an output channel', () => {
      const channel = getTranscriptChannel();
      expect(channel).toBeDefined();
      expect(window.createOutputChannel).toHaveBeenCalledWith('GemStone Transcript');
    });

    it('returns the same channel on subsequent calls', () => {
      const ch1 = getTranscriptChannel();
      const ch2 = getTranscriptChannel();
      expect(ch1).toBe(ch2);
    });
  });

  describe('appendTranscript', () => {
    it('appends non-empty text to channel', () => {
      const channel = getTranscriptChannel();
      appendTranscript('Hello from Transcript');
      expect(channel.appendLine).toHaveBeenCalledWith('Hello from Transcript');
    });

    it('skips empty strings', () => {
      const channel = getTranscriptChannel();
      appendTranscript('');
      expect(channel.appendLine).not.toHaveBeenCalled();
    });
  });

  describe('showTranscript', () => {
    it('shows the output channel', () => {
      showTranscript();
      const channel = getTranscriptChannel();
      expect(channel.show).toHaveBeenCalledWith(true);
    });
  });
});
