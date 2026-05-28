import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme';

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    shadowColor: '#1F2A22',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    padding: spacing.lg,
  },
});
