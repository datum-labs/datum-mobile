import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from 'expo-router';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

/** Feeds the Datum palette to the native navigation chrome (headers, tab bar, sheets). */
export function NavigationTheme({ children }: { children: ReactNode }) {
  const t = useDatumTheme();
  const theme = useMemo<Theme>(() => {
    const base = t.scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: t.scheme === 'dark',
      colors: {
        ...base.colors,
        primary: t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord,
        background: t.colors.background,
        card: t.colors.background,
        text: t.colors.foreground,
        border: t.colors.border,
        notification: t.colors.destructive,
      },
      fonts: {
        regular: { fontFamily: t.fonts.sans.regular, fontWeight: '400' },
        medium: { fontFamily: t.fonts.sans.medium, fontWeight: '500' },
        bold: { fontFamily: t.fonts.sans.semibold, fontWeight: '600' },
        heavy: { fontFamily: t.fonts.sans.semibold, fontWeight: '700' },
      },
    };
  }, [t]);
  return <ThemeProvider value={theme}>{children}</ThemeProvider>;
}

/** Shared native-stack options: large Canela titles under a transparent (Liquid Glass) bar. */
export function useStackScreenOptions() {
  const t = useDatumTheme();
  const tint = t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord;
  return useMemo(
    () => ({
      headerLargeTitle: true,
      headerTransparent: true,
      headerShadowVisible: false,
      headerLargeTitleShadowVisible: false,
      headerTintColor: tint,
      headerLargeTitleStyle: { fontFamily: t.fonts.title, color: t.colors.foreground },
      headerTitleStyle: { fontFamily: t.fonts.sans.semibold, color: t.colors.foreground },
      headerBackButtonDisplayMode: 'minimal' as const,
      contentStyle: { backgroundColor: t.colors.background },
    }),
    [t, tint]
  );
}
