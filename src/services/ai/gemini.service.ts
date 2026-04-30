import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { env } from '@/config/env';
import { BadRequestException } from '@/common/errors/app.exception';

export const geminiOutputSchema = z.object({
  amount: z.number().positive(),
  type: z.enum(['INCOME', 'EXPENSE']),
  categoryHint: z.string().min(1),
  channelHint: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export type GeminiFinancialOutput = z.infer<typeof geminiOutputSchema>;

const geminiAudioOutputSchema = geminiOutputSchema.extend({
  transcription: z.string().min(1),
});
export type GeminiAudioOutput = z.infer<typeof geminiAudioOutputSchema>;

@Injectable()
export class GeminiService {
  private readonly client = new GoogleGenerativeAI(env.GEMINI_API_KEY);

  async extractFinancialData(
    message: string,
    context?: { channelNames?: string[]; categoryNames?: string[] },
  ): Promise<GeminiFinancialOutput> {
    const model = this.client.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const contextLines = this.buildContextLines(context);

    const prompt = [
      'Você é um extrator de dados financeiros para vendedores de marketplace brasileiros.',
      ...contextLines,
      'Responda SOMENTE JSON válido, sem markdown e sem texto adicional.',
      'Se a mensagem NÃO for uma transação financeira (ex: "oi", "bom dia"), retorne amount: 0 e confidence: 0.',
      'Formato obrigatório:',
      '{"amount": number, "type": "INCOME"|"EXPENSE", "categoryHint": string, "channelHint": string|null, "confidence": number}',
      `Mensagem: ${message}`,
    ].join('\n');

    try {
      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(cleaned);
      } catch {
        throw new BadRequestException('Gemini retornou JSON inválido');
      }

      const parsed = geminiOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new BadRequestException(
          'Resposta do Gemini fora do schema esperado',
          parsed.error.flatten(),
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Não consegui processar sua mensagem agora. Por favor, tente novamente em instantes.');
    }
  }

  async extractFinancialDataFromAudioBase64(
    audioBase64: string,
    mimeType: string,
    context?: { channelNames?: string[]; categoryNames?: string[] },
  ): Promise<GeminiAudioOutput> {
    const model = this.client.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const contextLines = this.buildContextLines(context);

    const prompt = [
      'Você é um extrator de dados financeiros para vendedores de marketplace brasileiros.',
      'Ouça o áudio, transcreva e extraia os dados financeiros.',
      'REGRA DE TRANSCRIÇÃO: Na chave "transcription", escreva os valores monetários sempre com a palavra (exemplo: "20 reais") e NUNCA use o símbolo matemático "R$".',
      ...contextLines,
      'Responda SOMENTE JSON válido, sem markdown e sem texto adicional.',
      'Formato obrigatório:',
      '{"transcription": string, "amount": number, "type": "INCOME"|"EXPENSE", "categoryHint": string, "channelHint": string|null, "confidence": number}',
    ].join('\n');

    const result = await model.generateContent([
      { inlineData: { data: audioBase64, mimeType } },
      prompt,
    ]);

    const rawText = result.response.text().trim();
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const parsedJson = JSON.parse(cleaned);
      const parsed = geminiAudioOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new BadRequestException('Resposta do Gemini (áudio) fora do schema esperado');
      }
      return parsed.data;
    } catch {
      throw new BadRequestException('Não consegui processar seu áudio agora. Por favor, tente novamente em instantes.');
    }
  }

  private buildContextLines(context?: { channelNames?: string[]; categoryNames?: string[] }): string[] {
    const lines: string[] = [];

    lines.push('Se a mensagem mencionar uma plataforma ou canal de venda (ex: Shopee, Mercado Livre, OLX, Magalu, Amazon, Shein, etc.), SEMPRE retorne o nome no campo channelHint.');
    lines.push('REGRA PARA VALORES: O campo "amount" deve representar SEMPRE o valor TOTAL da transação. Se o usuário disser "vendi 50 bolas a 10 reais cada", o amount é 500. Se disser "vendi 50 bolas e deu 10 reais", o amount é 10. Preste atenção no contexto da frase.');

    if (context?.channelNames?.length) {
      lines.push(`Canais já cadastrados pelo usuário: ${context.channelNames.join(', ')}`);
      lines.push('Se a mensagem mencionar algum desses canais (mesmo com grafia diferente ou erros de digitação), retorne o nome exato cadastrado no campo channelHint.');
      lines.push('Se mencionar um canal NOVO que não está na lista, retorne o nome correto do canal (ex: "shope" → "Shopee").');
    }

    if (context?.categoryNames?.length) {
      lines.push(`Categorias cadastradas pelo usuário: ${context.categoryNames.join(', ')}`);
      lines.push('Tente encaixar a transação em uma dessas categorias no campo categoryHint.');
      lines.push('REGRA DE VENDA: Se o usuário usou verbos como "vendi" ou indicou a comercialização de um produto especificando qual foi o produto (ex: "vendi bola", "venda de sapato na shopee"), extraia o NOME DO PRODUTO para ser a categoria (ex: "Bola", "Sapato").');
      lines.push('REGRA DE OBRIGAÇÃO: Se o usuário mencionar uma venda mas NÃO citar o produto/categoria (ex: apenas "vendi 50 reais na shopee" ou "entrou 100 reais"), você DEVE obrigatoriamente retornar "NÃO_ESPECIFICADO" no categoryHint.');
    } else {
      lines.push('REGRA DE OBRIGAÇÃO: Se o usuário mencionar uma venda mas NÃO citar o produto/categoria (ex: apenas "vendi 50 reais na shopee" ou "entrou 100 reais"), você DEVE obrigatoriamente retornar "NÃO_ESPECIFICADO" no categoryHint. Caso contrário, use o nome do produto vendido como categoryHint.');
    }

    return lines;
  }
}
