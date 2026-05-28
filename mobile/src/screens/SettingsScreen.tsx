import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { CategoryResponse, ChannelResponse, UserResponse } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { colors, spacing } from '../theme';

interface SettingsScreenProps {
  user: UserResponse | null;
  categories: CategoryResponse[];
  channels: ChannelResponse[];
  onRefresh: () => Promise<void> | void;
  onLogout: () => void;
}

export function SettingsScreen({
  user,
  categories,
  channels,
  onRefresh,
  onLogout,
}: SettingsScreenProps) {
  const [categoryName, setCategoryName] = useState('');
  const [categoryColor, setCategoryColor] = useState('#007338');
  const [savingCategory, setSavingCategory] = useState(false);

  const createCategory = async () => {
    if (!categoryName.trim()) {
      Alert.alert('Nome obrigatorio', 'Digite um nome para a categoria.');
      return;
    }

    setSavingCategory(true);
    try {
      await api.createCategory({
        name: categoryName.trim(),
        color: categoryColor,
      });
      setCategoryName('');
      await onRefresh();
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Nao foi possivel criar a categoria.';
      Alert.alert('Categoria nao salva', message);
    } finally {
      setSavingCategory(false);
    }
  };

  return (
    <View style={styles.stack}>
      <View style={styles.rowBetween}>
        <Text style={styles.screenTitle}>Ajustes</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.refresh}>Atualizar</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Perfil</Text>
        <Text style={styles.name}>{user?.name ?? 'Usuario'}</Text>
        <Text style={styles.meta}>{user?.phone ?? 'Telefone nao carregado'}</Text>
        {user?.email ? <Text style={styles.meta}>{user.email}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Chatbot</Text>
        <Text style={styles.copy}>
          Os lancamentos feitos pelo Telegram aparecem automaticamente no app quando a conta
          esta vinculada ao mesmo usuario.
        </Text>
        <View style={styles.statusPill}>
          <Text style={styles.statusText}>Vinculo via telegramId no backend</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Categorias</Text>
        <View style={styles.formBox}>
          <TextField
            label="Nova categoria"
            value={categoryName}
            onChangeText={setCategoryName}
            placeholder="Ex: Moradia, Transporte, Taxas"
          />
          <Text style={styles.smallLabel}>Cor da categoria</Text>
          <View style={styles.swatches}>
            {['#007338', '#CBA64B', '#B94737', '#2F6DB3', '#7A4CB0', '#334155'].map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  categoryColor === color && styles.swatchSelected,
                ]}
                onPress={() => setCategoryColor(color)}
                accessibilityRole="button"
              />
            ))}
          </View>
          <Button
            label="Adicionar categoria"
            onPress={createCategory}
            loading={savingCategory}
            disabled={!categoryName.trim()}
          />
        </View>

        {categories.length === 0 ? (
          <Text style={styles.copy}>Nenhuma categoria cadastrada.</Text>
        ) : (
          categories.map((category) => (
            <View key={category.id} style={styles.listRow}>
              <View style={styles.categoryName}>
                <View style={[styles.dot, { backgroundColor: category.color }]} />
                <Text style={styles.rowTitle}>{category.name}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Canais de venda</Text>
        {channels.length === 0 ? (
          <Text style={styles.copy}>Nenhum canal cadastrado.</Text>
        ) : (
          channels.map((channel) => (
            <View key={channel.id} style={styles.listRow}>
              <Text style={styles.rowTitle}>{channel.name}</Text>
              <Text style={styles.rowMeta}>{Number(channel.feePercent).toFixed(2)}%</Text>
            </View>
          ))
        )}
      </Card>

      <Button label="Sair" variant="danger" onPress={onLogout} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  screenTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  refresh: {
    color: colors.primary,
    fontWeight: '800',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    marginTop: spacing.xs,
  },
  copy: {
    color: colors.muted,
    lineHeight: 21,
  },
  formBox: {
    backgroundColor: colors.sand,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  smallLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    borderColor: colors.surface,
    borderRadius: 8,
    borderWidth: 2,
    height: 34,
    width: 34,
  },
  swatchSelected: {
    borderColor: colors.text,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  listRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  categoryName: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  rowTitle: {
    color: colors.text,
    fontWeight: '800',
  },
  rowMeta: {
    color: colors.muted,
    fontWeight: '800',
  },
});
