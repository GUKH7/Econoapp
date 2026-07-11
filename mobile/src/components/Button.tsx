import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors, spacing } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color={isPrimary || isDanger ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            isPrimary && styles.primaryLabel,
            isDanger && styles.primaryLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  danger: {
    backgroundColor: colors.expense,
    borderColor: colors.expense,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '800',
  },
  primaryLabel: {
    color: colors.onPrimary,
  },
});
