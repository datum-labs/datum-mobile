import { Text } from '@datum-cloud/datum-ui-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

/** Grouped block with a small caps heading, like an inset table section. */
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
          <Text size="xs" weight="semibold" tone="muted" style={styles.title}>
            {title.toUpperCase()}
          </Text>
          {action}
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  title: { letterSpacing: 0.6 },
  body: { gap: 8 },
});
