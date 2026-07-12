import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ApiError, api, setAccessToken } from './src/api/client';
import type {
  AuthTokensResponse,
  CategoryResponse,
  ChannelResponse,
  DashboardSummaryResponse,
  TransactionResponse,
  UserResponse,
} from './src/api/types';
import { AuthScreen } from './src/screens/AuthScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TransactionsScreen } from './src/screens/TransactionsScreen';
import { SimulatorScreen } from './src/screens/SimulatorScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors, spacing } from './src/theme';
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from './src/auth/session-storage';

type Tab = 'dashboard' | 'transactions' | 'simulator' | 'settings';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Inicio' },
  { id: 'transactions', label: 'Transacoes' },
  { id: 'simulator', label: 'Planejar' },
  { id: 'settings', label: 'Mais' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [tokens, setTokens] = useState<AuthTokensResponse | null>(null);
  const [user, setUser] = useState<UserResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummaryResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionResponse[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringSession, setRestoringSession] = useState(true);
  const [resetToken, setResetToken] = useState('');

  useEffect(() => {
    const captureToken = (url: string | null) => {
      if (!url) return;
      const token = new URL(url).searchParams.get('token');
      if (token) setResetToken(token);
    };
    void Linking.getInitialURL().then(captureToken);
    const subscription = Linking.addEventListener('url', ({ url }) => captureToken(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void loadStoredSession()
      .then(async (stored) => {
        if (!stored) return;
        try {
          const refreshed = await api.refresh(stored.refreshToken);
          await saveStoredSession(refreshed.data);
          setTokens(refreshed.data);
        } catch {
          await clearStoredSession();
        }
      })
      .finally(() => setRestoringSession(false));
  }, []);

  useEffect(() => {
    setAccessToken(tokens?.accessToken ?? null);
  }, [tokens]);

  const loadPrivateData = useCallback(async () => {
    setLoading(true);
    try {
      const [me, summary, transactionList, categoryList, channelList] = await Promise.all([
        api.me(),
        api.dashboard(),
        api.listTransactions({ limit: 20 }),
        api.listCategories(),
        api.listChannels(),
      ]);

      setUser(me.data);
      setDashboard(summary.data);
      setTransactions(transactionList.data);
      setCategories(categoryList.data);
      setChannels(channelList.data);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Nao foi possivel carregar seus dados financeiros.';
      Alert.alert('Algo saiu do lugar', message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokens) {
      void loadPrivateData();
    }
  }, [loadPrivateData, tokens]);

  const handleAuthenticated = (authTokens: AuthTokensResponse) => {
    void saveStoredSession(authTokens);
    setTokens(authTokens);
    setActiveTab('dashboard');
  };

  const handleLogout = () => {
    void clearStoredSession();
    setTokens(null);
    setUser(null);
    setDashboard(null);
    setTransactions([]);
    setCategories([]);
    setChannels([]);
  };

  const refreshData = async () => {
    await loadPrivateData();
  };

  const screen = useMemo(() => {
    if (activeTab === 'dashboard') {
      return (
        <DashboardScreen
          dashboard={dashboard}
          transactions={transactions}
          onRefresh={refreshData}
        />
      );
    }

    if (activeTab === 'transactions') {
      return (
        <TransactionsScreen
          categories={categories}
          channels={channels}
          transactions={transactions}
          onCreated={refreshData}
        />
      );
    }

    if (activeTab === 'simulator') {
      return <SimulatorScreen />;
    }

    return (
      <SettingsScreen
        user={user}
        categories={categories}
        channels={channels}
        onRefresh={refreshData}
        onLogout={handleLogout}
      />
    );
  }, [activeTab, categories, channels, dashboard, transactions, user]);

  if (restoringSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.sessionLoader}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.subtitle}>Restaurando sua sessão...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!tokens) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <AuthScreen
          onAuthenticated={handleAuthenticated}
          resetToken={resetToken}
          onPasswordReset={() => setResetToken('')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={require('./assets/adaptive-icon.png')} style={styles.brandMark} />
          <View>
            <Text style={styles.appName}>Din</Text>
            <Text style={styles.subtitle}>
              {user ? `Ola, ${user.name}` : 'Sua visao financeira'}
            </Text>
          </View>
        </View>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>{screen}</ScrollView>

      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tabButton, selected && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="button"
            >
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.sand,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandMark: {
    height: 38,
    width: 38,
  },
  appName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  sessionLoader: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  tabBar: {
    backgroundColor: colors.sand,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.xs,
    left: 0,
    padding: spacing.sm,
    position: 'absolute',
    right: 0,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.primarySoft,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: colors.primaryDark,
  },
});
