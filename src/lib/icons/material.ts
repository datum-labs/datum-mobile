import type { AndroidSymbol } from 'expo-symbols';

/**
 * SF Symbol → Material Symbol for Android. The app names icons by SF Symbol
 * (what iOS renders natively); `Icon` looks the Android one up here. Keep a
 * name in the same spirit rather than the closest glyph, and add an entry
 * whenever a new SF Symbol is used (the test checks every one in the app).
 */
export const MATERIAL_SYMBOLS: Record<string, AndroidSymbol> = {
  a: 'match_case',
  'arrow.down': 'arrow_downward',
  'arrow.left': 'arrow_back',
  'arrow.left.arrow.right': 'swap_horiz',
  'arrow.right': 'arrow_forward',
  'arrow.triangle.branch': 'alt_route',
  'arrow.up': 'arrow_upward',
  'arrow.up.right.square': 'open_in_new',
  asterisk: 'emergency',
  bolt: 'bolt',
  'building.2.fill': 'apartment',
  'cable.connector': 'cable',
  'chart.xyaxis.line': 'monitoring',
  checkmark: 'check',
  'checkmark.circle.fill': 'check_circle',
  'checkmark.seal.fill': 'verified',
  'chevron.down': 'expand_more',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'circle.dashed': 'radio_button_unchecked',
  clock: 'schedule',
  'clock.arrow.circlepath': 'history',
  cpu: 'memory',
  'doc.on.doc': 'content_copy',
  'doc.text.magnifyingglass': 'manage_search',
  'dot.radiowaves.left.and.right': 'sensors',
  'ellipsis.circle': 'more_horiz',
  'exclamationmark.circle.fill': 'error',
  'exclamationmark.octagon.fill': 'report',
  'exclamationmark.shield.fill': 'gpp_maybe',
  'exclamationmark.triangle.fill': 'warning',
  'folder.fill': 'folder',
  'gearshape.fill': 'settings',
  globe: 'language',
  'globe.americas.fill': 'public',
  'house.fill': 'home',
  'info.circle.fill': 'info',
  'iphone.gen3.radiowaves.left.and.right': 'mobile_share',
  keyboard: 'keyboard',
  'keyboard.chevron.compact.down': 'keyboard_hide',
  link: 'link',
  'list.bullet.rectangle': 'list_alt',
  'lock.shield.fill': 'shield_lock',
  magnifyingglass: 'search',
  'minus.circle': 'do_not_disturb_on',
  'pause.fill': 'pause',
  'person.2': 'group',
  'person.crop.circle': 'account_circle',
  'person.crop.circle.fill': 'account_circle',
  'person.fill': 'person',
  'play.fill': 'play_arrow',
  plus: 'add',
  'point.3.filled.connected.trianglepath.dotted': 'hub',
  'rectangle.portrait.and.arrow.right': 'logout',
  safari: 'open_in_browser',
  'server.rack': 'dns',
  'shippingbox.fill': 'deployed_code',
  'square.and.arrow.up': 'share',
  'square.and.pencil': 'edit_square',
  'square.stack.3d.down.right': 'stacks',
  'square.stack.3d.up': 'stacks',
  terminal: 'terminal',
  'tray.and.arrow.up': 'upload',
  'wrench.and.screwdriver.fill': 'build',
  xmark: 'close',
  'xmark.circle.fill': 'cancel',
};

/** Fallback for an unmapped symbol: a neutral dot rather than nothing. */
export const MATERIAL_FALLBACK: AndroidSymbol = 'circle';

export function materialSymbolFor(sfSymbol: string): AndroidSymbol {
  return MATERIAL_SYMBOLS[sfSymbol] ?? MATERIAL_FALLBACK;
}
