/**
 * Binaries built before the widgets (the installed dev client, older
 * TestFlight builds) have neither the DatumWidgets module nor the
 * background-task modules. Everything must quietly do nothing there.
 */
import { DatumWidgets } from '../../../../modules/datum-widgets';
import { cancelWidgetRefresh, runWidgetRefresh, scheduleWidgetRefresh } from '../background';
import { clearHealth, publishHealth, refreshWidgets, widgetsEnabled } from '../service';

// Hoisted above the imports by babel-jest.
jest.mock('expo', () => ({ ...jest.requireActual('expo'), requireOptionalNativeModule: () => null }));
const mockFetchQuery = jest.fn();
jest.mock('@/lib/query', () => ({ queryClient: { fetchQuery: (...args: unknown[]) => mockFetchQuery(...args) } }));
jest.mock('@/auth/instance', () => ({ session: { getState: () => ({ status: 'signedOut' }) } }));


test('the native module is optional', () => {
  expect(DatumWidgets.info()).toEqual({ available: false });
  expect(DatumWidgets.consumePendingRoute()).toBeNull();
  expect(DatumWidgets.requestedProjects()).toEqual([]);
  expect(() => DatumWidgets.reloadTimelines()).not.toThrow();
  expect(DatumWidgets.onPendingRoute(() => undefined).remove).toBeInstanceOf(Function);
  expect(widgetsEnabled()).toBe(false);
});

test('publishing, refreshing and the background task are no-ops', async () => {
  await expect(publishHealth({ currentProjectId: 'p' })).resolves.toBeUndefined();
  await expect(refreshWidgets({ sub: 'user' })).resolves.toBeUndefined();
  await expect(clearHealth()).resolves.toBeUndefined();
  await expect(scheduleWidgetRefresh()).resolves.toBeUndefined();
  await expect(cancelWidgetRefresh()).resolves.toBeUndefined();
  await expect(runWidgetRefresh()).resolves.toBe(false);
  expect(mockFetchQuery).not.toHaveBeenCalled();
});
