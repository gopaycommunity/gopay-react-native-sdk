import { GopaySDK } from '@gopaycz/gopay-react-native-sdk';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Native GoPay SDK</Text>
      <Text testID="sdk-version" style={styles.version}>
        {GopaySDK.version}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  label: { fontSize: 16, color: '#555' },
  version: { fontSize: 32, fontWeight: '600', marginTop: 8 },
});
