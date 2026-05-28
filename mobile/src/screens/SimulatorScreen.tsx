import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { colors, spacing } from '../theme';
import { formatCurrency, parseMoney } from '../utils/format';

export function SimulatorScreen() {
  const [initialAmount, setInitialAmount] = useState('1000');
  const [monthlyAmount, setMonthlyAmount] = useState('300');
  const [monthlyRate, setMonthlyRate] = useState('0,8');
  const [months, setMonths] = useState('24');

  const result = useMemo(() => {
    const initial = parseMoney(initialAmount);
    const monthly = parseMoney(monthlyAmount);
    const rate = parseMoney(monthlyRate) / 100;
    const duration = Math.max(0, Math.floor(parseMoney(months)));

    let balance = initial;
    const series: Array<{ month: number; balance: number }> = [];

    for (let month = 1; month <= duration; month += 1) {
      balance = balance * (1 + rate) + monthly;
      series.push({ month, balance });
    }

    const totalContributed = initial + monthly * duration;
    const earnings = balance - totalContributed;

    return {
      balance,
      totalContributed,
      earnings,
      series,
    };
  }, [initialAmount, monthlyAmount, monthlyRate, months]);

  return (
    <View style={styles.stack}>
      <Text style={styles.screenTitle}>Simulador</Text>

      <Card>
        <View style={styles.form}>
          <TextField
            label="Valor inicial"
            value={initialAmount}
            onChangeText={setInitialAmount}
            keyboardType="decimal-pad"
          />
          <TextField
            label="Aporte mensal"
            value={monthlyAmount}
            onChangeText={setMonthlyAmount}
            keyboardType="decimal-pad"
          />
          <TextField
            label="Rendimento mensal (%)"
            value={monthlyRate}
            onChangeText={setMonthlyRate}
            keyboardType="decimal-pad"
          />
          <TextField
            label="Prazo em meses"
            value={months}
            onChangeText={setMonths}
            keyboardType="number-pad"
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardLabel}>Saldo estimado</Text>
        <Text style={styles.balance}>{formatCurrency(result.balance)}</Text>
        <View style={styles.metrics}>
          <View>
            <Text style={styles.metricLabel}>Aportado</Text>
            <Text style={styles.metricValue}>{formatCurrency(result.totalContributed)}</Text>
          </View>
          <View>
            <Text style={styles.metricLabel}>Rendimento</Text>
            <Text style={styles.income}>{formatCurrency(result.earnings)}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Projecao</Text>
        {result.series.slice(-6).map((point) => (
          <View key={point.month} style={styles.listRow}>
            <Text style={styles.rowTitle}>Mes {point.month}</Text>
            <Text style={styles.rowValue}>{formatCurrency(point.balance)}</Text>
          </View>
        ))}
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
  cardLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  balance: {
    color: colors.text,
    fontSize: 32,
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
  metricValue: {
    color: colors.text,
    fontWeight: '900',
  },
  income: {
    color: colors.income,
    fontWeight: '900',
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
  rowTitle: {
    color: colors.text,
    fontWeight: '800',
  },
  rowValue: {
    color: colors.text,
    fontWeight: '900',
  },
});
