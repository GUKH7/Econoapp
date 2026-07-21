import { describe, expect, it } from 'vitest';
import { WhatsappActionClassifierService } from '@/modules/whatsapp/whatsapp-action-classifier.service';
import { WhatsappActionClassification } from '@/modules/whatsapp/whatsapp-action.types';

type RegressionPhrase = {
  text: string;
  expected: WhatsappActionClassification['action'];
  channel?: 'TEXT' | 'AUDIO_TRANSCRIPTION';
};

const phrases: RegressionPhrase[] = [
  { text: 'Quero criar uma categoria chamada Academia', expected: 'CREATE_CATEGORY' },
  { text: 'adiciona categoria Delivery', expected: 'CREATE_CATEGORY' },
  { text: 'cria uma nova categoria de gastos', expected: 'CREATE_CATEGORY' },
  { text: 'adciona uma categoria pra Pet shop', expected: 'CREATE_CATEGORY' },
  { text: 'add categoria rolê', expected: 'CREATE_CATEGORY' },
  { text: 'quais categorias eu tenho?', expected: 'LIST_CATEGORIES' },
  { text: 'me mostra minhas categorias', expected: 'LIST_CATEGORIES' },
  { text: 'renomear categoria Mercado para Supermercado', expected: 'UPDATE_CATEGORY' },
  { text: 'muda a categoria Uber pra Transporte', expected: 'UPDATE_CATEGORY' },
  { text: 'apaga a categoria Balada', expected: 'DELETE_CATEGORY' },
  { text: 'deleta categoria antiga', expected: 'DELETE_CATEGORY' },
  { text: 'gastei 45 reais no mercado', expected: 'CREATE_TRANSACTION' },
  { text: 'paguei r$ 19,90 no ifood', expected: 'CREATE_TRANSACTION' },
  { text: 'gstei 20,00 de uber', expected: 'CREATE_TRANSACTION' },
  { text: 'recebi R$ 800 de um freela', expected: 'CREATE_TRANSACTION' },
  { text: 'vendi por 120 reais hj', expected: 'CREATE_TRANSACTION' },
  { text: 'quanto gastei este mês?', expected: 'QUERY_EXPENSES' },
  { text: 'mostra os gastos da categoria Saúde', expected: 'QUERY_EXPENSES' },
  { text: 'gastos da semana', expected: 'QUERY_EXPENSES' },
  { text: 'define orçamento de R$ 500 pra Mercado', expected: 'SET_BUDGET' },
  { text: 'coloca limite 300,00 na categoria Lazer', expected: 'SET_BUDGET' },
  { text: 'criar conta chamada Nubank', expected: 'CREATE_ACCOUNT' },
  { text: 'adiciona uma carteira Dinheiro', expected: 'CREATE_ACCOUNT' },
  { text: 'criar conta a receber de 250 reais', expected: 'CREATE_RECEIVABLE' },
  { text: 'o João me deve R$ 90', expected: 'CREATE_RECEIVABLE' },
  { text: 'adicionar conta a pagar de R$ 180', expected: 'CREATE_PAYABLE' },
  { text: 'tenho que pagar o fornecedor 500 reais', expected: 'CREATE_PAYABLE' },
  { text: 'eu queria criar uma categoria chamada material de trabalho', expected: 'CREATE_CATEGORY', channel: 'AUDIO_TRANSCRIPTION' },
  { text: 'anota aí que eu gastei cinquenta e dois reais com almoço', expected: 'CREATE_TRANSACTION', channel: 'AUDIO_TRANSCRIPTION' },
  { text: 'quanto que eu gastei com comida esse mês', expected: 'QUERY_EXPENSES', channel: 'AUDIO_TRANSCRIPTION' },
];

describe('WhatsappActionClassifierService regressão de linguagem real', () => {
  const classifier = new WhatsappActionClassifierService();

  it.each(phrases)('$channel $text -> $expected', ({ text, expected }) => {
    expect(classifier.classify(text)?.action).toBe(expected);
  });

  it('prioriza o verbo criar mesmo quando a frase contém gastos', () => {
    expect(classifier.classify('quero criar uma categoria de gastos')?.action).toBe('CREATE_CATEGORY');
  });

  it('marca categoria isolada como ambígua', () => {
    expect(classifier.classify('categoria Viagem')).toEqual(expect.objectContaining({
      action: 'UNKNOWN',
      ambiguity: 'CATEGORY_CREATE_OR_QUERY',
      entities: expect.objectContaining({ categoryName: 'Viagem' }),
    }));
  });
});

