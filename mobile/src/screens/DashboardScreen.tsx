import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DashboardSummaryResponse, TransactionResponse } from '../api/types';
import { Card } from '../components/Card';
import { colors, spacing } from '../theme';
import { formatCurrency, formatDate } from '../utils/format';

interface DashboardScreenProps {
  dashboard: DashboardSummaryResponse | null;
  transactions: TransactionResponse[];
  onRefresh: () => void;
}

export function DashboardScreen({ dashboard, transactions, onRefresh }: DashboardScreenProps) {
  if (!dashboard) {
    return (
      <View style={styles.stack}>
        <Text style={styles.empty}>Carregando sua visao financeira...</Text>
      </View>
    );
  }

  const recent = transactions.slice(0, 3);

  return (
    <View style={styles.stack}>
      <View style={styles.rowBetween}>
        <Text style={styles.screenTitle}>Resumo</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.refresh}>Atualizar</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={styles.cardLabel}>Saldo do periodo</Text>
        <Text style={[styles.balance, dashboard.balance < 0 && styles.negative]}>
          {formatCurrency(dashboard.balance)}
        </Text>
        <View style={styles.metrics}>
          <View>
            <Text style={styles.metricLabel}>Receitas</Text>
            <Text style={styles.income}>{formatCurrency(dashboard.totalIncome)}</Text>
          </View>
          <View>
            <Text style={styles.metricLabel}>Gastos</Text>
            <Text style={styles.expense}>{formatCurrency(dashboard.totalExpense)}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Últimos lançamentos</Text>
        {recent.length === 0 ? (
          <Text style={styles.empty}>Nenhum lançamento ainda.</Text>
        ) : (
          recent.map((transaction) => (
            <View key={transaction.id} style={styles.listRow}>
              <View>
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
  cardLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  balance: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
    marginTop: spacing.xs,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.lg,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  income: {
    color: colors.income,
    fontWeight: '900',
  },
  expense: {
    color: colors.expense,
    fontWeight: '900',
  },
  negative: {
    color: colors.expense,
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
  empty: {
    color: colors.muted,
    lineHeight: 20,
  },
});
