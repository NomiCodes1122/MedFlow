import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthClient } from './src/modules/auth/auth.client';
import { SyncApiClient } from './src/core/api/api.client';
import { SecureStoreService } from './src/core/api/secure-store';

// Retrieve backend URL from environment variables, fallback to local dev
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'fake-key';

const apiClient = new SyncApiClient({ baseUrl: API_URL });
const authClient = new AuthClient(apiClient, SUPABASE_URL, SUPABASE_ANON_KEY);

const Stack = createNativeStackNavigator();

function LoginScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRequestOtp = async () => {
    setLoading(true);
    setError('');
    try {
      await authClient.requestOtp(phone);
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to request OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    setError('');
    try {
      await authClient.verifyOtpAndLogin(phone, token);
      navigation.replace('Home');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>MedFlow Responder Login</Text>
      
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {step === 1 ? (
        <View style={styles.form}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="+1234567890"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
          />
          <Button title="Request OTP" onPress={handleRequestOtp} disabled={loading || !phone} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Verification Code</Text>
          <TextInput
            style={styles.input}
            placeholder="123456"
            value={token}
            onChangeText={setToken}
            keyboardType="number-pad"
            autoCapitalize="none"
          />
          <Button title="Verify & Login" onPress={handleVerifyOtp} disabled={loading || !token} />
          <TouchableOpacity onPress={() => setStep(1)} style={{ marginTop: 10 }}>
            <Text style={styles.linkText}>Back to Phone</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {loading && <ActivityIndicator size="large" style={{ marginTop: 20 }} />}
    </SafeAreaView>
  );
}

function HomeScreen({ navigation }: any) {
  const handleLogout = async () => {
    await authClient.logout();
    navigation.replace('Login');
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>MedFlow Dashboard</Text>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Text>API: Connected ({API_URL})</Text>
        <Text>Role: Responding Paramedic</Text>
      </View>

      <View style={styles.grid}>
        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Patients')}>
          <Text style={styles.gridButtonText}>Patients</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Alerts')}>
          <Text style={styles.gridButtonText}>Alerts</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Sync')}>
          <Text style={styles.gridButtonText}>Sync Status</Text>
        </TouchableOpacity>
      </View>

      <Button title="Logout" onPress={handleLogout} color="#d9534f" />
    </SafeAreaView>
  );
}

function PatientsScreen() {
  // Mock display since Patient client might require complex setup for MVP
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Patients</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Offline Storage</Text>
        <Text>Currently no patients assigned.</Text>
      </View>
    </SafeAreaView>
  );
}

function AlertsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Alerts & Notifications</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Inbox Empty</Text>
        <Text>No new emergency alerts received.</Text>
      </View>
    </SafeAreaView>
  );
}

function SyncScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Sync Status</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Engine Status: Idle</Text>
        <Text>Pending Uploads: 0</Text>
        <Text>Last Sync: Just now</Text>
      </View>
    </SafeAreaView>
  );
}

function AppNavigator() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    const checkToken = async () => {
      const token = await SecureStoreService.getAccessToken();
      if (token) {
        setInitialRoute('Home');
      } else {
        setInitialRoute('Login');
      }
    };
    checkToken();
  }, []);

  if (!initialRoute) return <ActivityIndicator size="large" style={{ flex: 1 }} />;

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Dashboard' }} />
        <Stack.Screen name="Patients" component={PatientsScreen} />
        <Stack.Screen name="Alerts" component={AlertsScreen} />
        <Stack.Screen name="Sync" component={SyncScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return <AppNavigator />;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f4f4f8' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#333' },
  form: { width: '100%' },
  label: { fontSize: 16, marginBottom: 8, color: '#555' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { color: '#d9534f', marginBottom: 16 },
  linkText: { color: '#007bff', textAlign: 'center' },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 8, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 },
  gridButton: { backgroundColor: '#007bff', padding: 20, borderRadius: 8, width: '48%', marginBottom: 16, alignItems: 'center' },
  gridButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
