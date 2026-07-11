import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { AuthTokensResponse } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { colors, spacing } from '../theme';

interface AuthScreenProps {
  onAuthenticated: (tokens: AuthTokensResponse) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const loginId = phoneOrEmail.trim();
      const loginPhone = loginId.replace(/\D/g, '');
      const response =
        mode === 'login'
          ? await api.login({
              [loginId.includes('@') ? 'email' : 'phone']: loginId.includes('@')
                ? loginId
                : loginPhone,
              password,
            })
          : await api.register({
              name,
              phone: phone.replace(/\D/g, ''),
              email: email.trim() || undefined,
              password,
            });

      onAuthenticated(response.data);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Nao foi possivel autenticar agora.';
      Alert.alert('Acesso nao concluido', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>Din</Text>
        <Text style={styles.title}>Seu dinheiro,{`\n`}mais <Text style={styles.titleAccent}>inteligente.</Text></Text>
        <Text style={styles.subtitle}>O copiloto financeiro que aprende com você e ajuda a tomar decisões melhores todos os dias.</Text>
      </View>

      <Card>
        <View style={styles.form}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Entrar', value: 'login' },
              { label: 'Cadastrar', value: 'register' },
            ]}
          />

          {mode === 'register' ? (
            <>
              <TextField label="Nome" value={name} onChangeText={setName} />
              <TextField
                label="Telefone"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </>
          ) : (
            <TextField
              label="Telefone ou email"
              value={phoneOrEmail}
              onChangeText={setPhoneOrEmail}
              autoCapitalize="none"
            />
          )}

          <TextField
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <Button
            label={mode === 'login' ? 'Entrar' : 'Criar conta'}
            onPress={submit}
            loading={loading}
            disabled={mode === 'login' ? !phoneOrEmail || !password : !name || !phone || !password}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  hero: {
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
  },
  wordmark: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  titleAccent: {
    color: colors.primaryDark,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: spacing.sm,
  },
  form: {
    gap: spacing.md,
  },
});
