import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type {
  CategoryResponse,
  ChannelResponse,
  TransactionResponse,
  TransactionType,
} from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { colors, spacing } from '../theme';
import { formatCurrency, formatDate, parseMoney } from '../utils/format';

interface TransactionsScreenProps {
  transactions: TransactionResponse[];
  categories: CategoryResponse[];
  channels: ChannelResponse[];
  onCreated: () => Promise<void>;
}

export function TransactionsScreen({
  transactions,
  categories,
  channels,
  onCreated,
}: TransactionsScreenProps) {
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#007338');
  const [channelId, setChannelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);

  const selectedCategoryId = categoryId || categories[0]?.id;

  const createCategory = async () => {
    if (!newCategoryName.trim()) {
      Alert.alert('Nome obrigatorio', 'Digite o nome da categoria.');
      return;
    }

    setCreatingCategory(true);
    try {
      const response = await api.createCategory({
        name: newCategoryName.trim(),
        color: newCategoryColor,
      });
      setCategoryId(response.data.id);
      setNewCategoryName('');
      await onCreated();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Nao foi possivel criar a categoria.';
      Alert.alert('Categoria nao salva', message);
    } finally {
      setCreatingCategory(false);
    }
  };

  const create = async () => {
    if (!selectedCategoryId) {
      Alert.alert('Categoria obrigatoria', 'Crie uma categoria antes de lancar.');
      return;
    }

    setSaving(true);
    try {
      await api.createTransaction({
        description,
        amount: parseMoney(amount),
        type,
        source: 'MANUAL',
        categoryId: selectedCategoryId,
        channelId: channelId || undefined,
      });
      setDescription('');
      setAmount('');
      setCategoryId('');
      setChannelId('');
      await onCreated();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Nao foi possivel criar o lancamento.';
      Alert.alert('Lancamento nao salvo', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.screenTitle}>Lancamentos</Text>

      <Card>
        <View style={styles.form}>
          <SegmentedControl
            value={type}
            onChange={setType}
            options={[
              { label: 'Gasto', value: 'EXPENSE' },
              { label: 'Receita', value: 'INCOME' },
            ]}
          />
          <TextField
            label="Descricao"
            value={description}
            onChangeText={setDescription}
            placeholder="Ex: Venda Shopee, mercado, frete..."
          />
          <TextField
            label="Valor"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0,00"
          />

          <Text style={styles.fieldLabel}>Categoria</Text>
          <View style={styles.chips}>
            {categories.map((category) => {
              const selected = selectedCategoryId === category.id;
              return (
                <TouchableOpacity
                  key={category.id}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => setCategoryId(category.id)}
                >
                  <View style={[styles.dot, { backgroundColor: category.color }]} />
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {category.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {categories.length === 0 ? (
            <Text style={styles.helperText}>
              Crie sua primeira categoria para habilitar os lancamentos.
            </Text>
          ) : null}

          <View style={styles.inlineCreate}>
            <TextField
              label="Nova categoria"
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Ex: Mercado, Frete, Alimentacao"
            />
            <Text style={styles.fieldLabel}>Cor</Text>
            <View style={styles.swatches}>
              {['#007338', '#CBA64B', '#B94737', '#2F6DB3', '#7A4CB0'].map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.swatch,
                    { backgroundColor: color },
                    newCategoryColor === color && styles.swatchSelected,
                  ]}
                  onPress={() => setNewCategoryColor(color)}
                  accessibilityRole="button"
                />
              ))}
            </View>
            <Button
              label="Criar categoria"
              variant="ghost"
              onPress={createCategory}
              loading={creatingCategory}
              disabled={!newCategoryName.trim()}
            />
          </View>

          <Text style={styles.fieldLabel}>Canal de venda</Text>
          <View style={styles.chips}>
            <TouchableOpacity
              style={[styles.chip, !channelId && styles.chipActive]}
              onPress={() => setChannelId('')}
            >
              <Text style={[styles.chipText, !channelId && styles.chipTextActive]}>
                Sem canal
              </Text>
            </TouchableOpacity>
            {channels.map((channel) => {
              const selected = channelId === channel.id;
              return (
                <TouchableOpacity
                  key={channel.id}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => setChannelId(channel.id)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                    {channel.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button
            label="Salvar lancamento"
            onPress={create}
            loading={saving}
            disabled={!description || !amount}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Ultimos registros</Text>
        {transactions.length === 0 ? (
          <Text style={styles.empty}>Nenhum lancamento registrado.</Text>
        ) : (
          transactions.map((transaction) => (
            <View key={transaction.id} style={styles.listRow}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{transaction.description}</Text>
                <Text style={styles.rowMeta}>
                  {formatDate(transaction.date)} • {transaction.source}
                </Text>
              </View>
              <Text
                style={[
                  styles.rowValue,
                  transaction.type === 'EXPENSE' ? styles.expense : styles.income,
                ]}
              >
                {formatCurrency(transaction.netAmount)}
              </Text>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  screenTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  form: {
    gap: spacing.md,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  helperText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  inlineCreate: {
    backgroundColor: colors.sand,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  swatches: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  swatch: {
    borderColor: colors.surface,
    borderRadius: 8,
    borderWidth: 2,
    height: 32,
    width: 32,
  },
  swatchSelected: {
    borderColor: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.muted,
    fontWeight: '800',
  },
  chipTextActive: {
    color: colors.primary,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  listRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  income: {
    color: colors.income,
  },
  expense: {
    color: colors.expense,
  },
  empty: {
    color: colors.muted,
    lineHeight: 20,
  },
});
