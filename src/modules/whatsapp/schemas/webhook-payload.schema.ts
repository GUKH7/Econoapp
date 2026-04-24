import { z } from 'zod';

const textMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.literal('text'),
  text: z.object({
    body: z.string(),
  }),
});

const audioMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.literal('audio'),
  audio: z.object({
    id: z.string(),
    mime_type: z.string().optional(),
  }),
});

const unknownMessageSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    type: z.string(), // qualquer outro tipo (imagem, sticker, localização, etc.)
  })
  .passthrough(); // aceita campos extras sem rejeitar o payload

const messageSchema = z.union([textMessageSchema, audioMessageSchema, unknownMessageSchema]);

export const whatsappWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messaging_product: z.literal('whatsapp').optional(),
            metadata: z
              .object({
                display_phone_number: z.string().optional(),
                phone_number_id: z.string().optional(),
              })
              .optional(),
            contacts: z
              .array(
                z.object({
                  wa_id: z.string(),
                }),
              )
              .optional(),
            messages: z.array(messageSchema).optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export type WhatsAppWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
