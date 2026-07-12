import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { AuthTokensResponse } from '../api/types';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { TextField } from '../components/TextField';
import { colors, spacing } from '../theme';

interface AuthScreenProps {
  onAuthenticated: (tokens: AuthTokensResponse) => void;
  resetToken?: string;
  onPasswordReset?: () => void;
}

export function AuthScreen({ onAuthenticated, resetToken = '', onPasswordReset }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(resetToken ? 'reset' : 'login');
  const [name, setName] = useState('');
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email.trim());
        Alert.alert('Confira seu e-mail', 'Se houver uma conta cadastrada, enviaremos um link em alguns minutos.');
        setMode('login');
        return;
      }
      if (mode === 'reset') {
        if (password !== passwordConfirmation) {
          Alert.alert('Senhas diferentes', 'Digite a mesma senha nos dois campos.');
          return;
        }
        await api.resetPassword(resetToken, password);
        Alert.alert('Senha alterada', 'Entre novamente usando sua nova senha.');
        setPassword('');
        setPasswordConfirmation('');
        setMode('login');
        onPasswordReset?.();
        return;
      }
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
        <View style={styles.brandRow}>
          <Image source={require('../../assets/adaptive-icon.png')} style={styles.brandMark} />
          <Text style={styles.wordmark}>Din</Text>
        </View>
        <Text style={styles.title}>Seu dinheiro,{`\n`}mais <Text style={styles.titleAccent}>inteligente.</Text></Text>
        <Text style={styles.subtitle}>O copiloto financeiro que aprende com você e ajuda a tomar decisões melhores todos os dias.</Text>
      </View>

      <Card>
        <View style={styles.form}>
          {mode === 'login' || mode === 'register' ? <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Entrar', value: 'login' },
              { label: 'Cadastrar', value: 'register' },
            ]}
          /> : null}

          {mode === 'forgot' ? (
            <>
              <Text style={styles.sectionTitle}>Recuperar senha</Text>
              <Text style={styles.subtitle}>Informe o e-mail cadastrado para receber um link seguro.</Text>
              <TextField label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </>
          ) : mode === 'reset' ? (
            <>
              <Text style={styles.sectionTitle}>Criar nova senha</Text>
              <TextField label="Nova senha" value={password} onChangeText={setPassword} secureTextEntry />
              <TextField label="Confirmar nova senha" value={passwordConfirmation} onChangeText={setPasswordConfirmation} secureTextEntry />
            </>
          ) : mode === 'register' ? (
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

          {mode !== 'forgot' && mode !== 'reset' ? <TextField
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          /> : null}

          <Button
            label={mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : mode === 'forgot' ? 'Enviar link' : 'Salvar nova senha'}
            onPress={submit}
            loading={loading}
            disabled={mode === 'login' ? !phoneOrEmail || !password : mode === 'register' ? !name || !phone || !password : mode === 'forgot' ? !email.trim() : !password || !passwordConfirmation}
          />
          {mode === 'login' ? <Button label="Esqueci minha senha" variant="ghost" onPress={() => setMode('forgot')} /> : null}
          {mode === 'forgot' ? <Button label="Voltar" variant="ghost" onPress={() => setMode('login')} /> : null}
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
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  brandMark: {
    height: 58,
    width: 58,
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
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
});
