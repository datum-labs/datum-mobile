import { useLocalSearchParams } from 'expo-router';

import { ConsoleLogsScreen } from '@/components/ConsoleLogsScreen';

export default function InstanceLogs() {
  const { instance } = useLocalSearchParams<{ instance: string }>();
  return <ConsoleLogsScreen title="Logs" context={instance} instanceNames={instance ? [instance] : undefined} />;
}
