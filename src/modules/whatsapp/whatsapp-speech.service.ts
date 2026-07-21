import { Injectable, Logger } from '@nestjs/common';
import { env } from '@/config/env';

@Injectable()
export class WhatsappSpeechService {
  private readonly logger = new Logger(WhatsappSpeechService.name);

  async synthesize(text: string): Promise<{ audioBase64: string; audioMimeType: string } | null> {
    if (!env.GOOGLE_TTS_API_KEY) return null;
    try {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: text.replace(/[*_~]/g, '').slice(0, 1_500) },
          voice: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-C' },
          audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: 1.05 },
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`TTS ${response.status}`);
      const body = await response.json() as { audioContent?: string };
      return body.audioContent ? { audioBase64: body.audioContent, audioMimeType: 'audio/ogg; codecs=opus' } : null;
    } catch (error) {
      this.logger.warn(`Resposta por audio indisponivel; usando texto: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
