import { Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { AccessoryKey } from '@/resources/console/protocol';

type KeyDef =
  | { kind: 'key'; key: AccessoryKey; label?: string; symbol?: SymbolViewProps['name']; a11y: string }
  | { kind: 'text'; text: string; a11y: string }
  | { kind: 'ctrl' };

/** Keys iOS keyboards lack, in the order terminal apps put them. */
export const KEY_BAR: readonly KeyDef[] = [
  { kind: 'key', key: 'esc', label: 'esc', a11y: 'Escape' },
  { kind: 'key', key: 'tab', label: 'tab', a11y: 'Tab' },
  { kind: 'ctrl' },
  { kind: 'key', key: 'left', symbol: 'arrow.left', a11y: 'Left arrow' },
  { kind: 'key', key: 'up', symbol: 'arrow.up', a11y: 'Up arrow' },
  { kind: 'key', key: 'down', symbol: 'arrow.down', a11y: 'Down arrow' },
  { kind: 'key', key: 'right', symbol: 'arrow.right', a11y: 'Right arrow' },
  { kind: 'text', text: '|', a11y: 'Pipe' },
  { kind: 'text', text: '~', a11y: 'Tilde' },
  { kind: 'text', text: '-', a11y: 'Hyphen' },
  { kind: 'text', text: '/', a11y: 'Slash' },
];

function tap() {
  void Haptics.selectionAsync().catch(() => undefined);
}

function Keycap({
  label,
  symbol,
  a11y,
  selected,
  onPress,
}: {
  label?: string;
  symbol?: SymbolViewProps['name'];
  a11y: string;
  selected?: boolean;
  onPress(): void;
}) {
  const t = useDatumTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.key,
        {
          backgroundColor: selected
            ? t.colors.foreground
            : pressed
              ? withAlpha(t.colors.foreground, 0.16)
              : t.colors.card,
          borderColor: t.colors.cardBorder,
        },
      ]}>
      {symbol ? (
        <Icon name={symbol} size={15} weight="semibold" />
      ) : (
        <Text
          mono
          size="sm"
          weight="medium"
          style={{ color: selected ? t.colors.background : t.colors.foreground }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * The row of terminal keys above the keyboard: Esc, Tab, a sticky Ctrl (the
 * next key typed goes as its control character), arrows and a few symbols
 * that sit behind the iOS keyboard's "123" layer. The last button shows or
 * hides the keyboard.
 */
export function ShellKeyBar({
  ctrl,
  keyboardShown,
  onKey,
  onText,
  onCtrl,
  onToggleKeyboard,
}: {
  ctrl: boolean;
  keyboardShown: boolean;
  onKey(key: AccessoryKey): void;
  onText(text: string): void;
  onCtrl(): void;
  onToggleKeyboard(): void;
}) {
  const t = useDatumTheme();
  return (
    <View style={[styles.bar, { borderTopColor: t.colors.border, backgroundColor: t.colors.background }]}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keys}>
        {KEY_BAR.map((def) => {
          switch (def.kind) {
            case 'ctrl':
              return <Keycap key="ctrl" label="ctrl" a11y="Control" selected={ctrl} onPress={onCtrl} />;
            case 'key':
              return (
                <Keycap
                  key={def.key}
                  label={def.label}
                  symbol={def.symbol}
                  a11y={def.a11y}
                  onPress={() => onKey(def.key)}
                />
              );
            case 'text':
              return <Keycap key={def.text} label={def.text} a11y={def.a11y} onPress={() => onText(def.text)} />;
          }
          return null;
        })}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={keyboardShown ? 'Hide keyboard' : 'Show keyboard'}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={() => {
          tap();
          onToggleKeyboard();
        }}
        style={styles.toggle}>
        <Icon name={keyboardShown ? 'keyboard.chevron.compact.down' : 'keyboard'} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  keys: { gap: 6, paddingHorizontal: 8, alignItems: 'center' },
  key: {
    minWidth: 42,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: { paddingHorizontal: 12, height: 36, justifyContent: 'center' },
});
