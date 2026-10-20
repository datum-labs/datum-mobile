import { Text } from '@datum-cloud/datum-ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

/** Grouped block with a bold sentence-case heading, as iOS 26 system apps title their sections. */
export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.header}>
          <Text size="lg" weight="semibold" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {action}
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  title: { flexShrink: 1 },
  body: { gap: 8 },
});
