/** Thin wrapper over the WebExtension APIs, the same in Chrome, Edge and Firefox (MV3 promises). */

declare const __SERVER__: string;
/** The Vanishnote server this build talks to (set at build time). */
export const SERVER: string = __SERVER__;

interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ExtensionApi {
  storage: { local: StorageArea; session?: StorageArea };
  runtime: { openOptionsPage(): Promise<void>; getURL(path: string): string };
  contextMenus: {
    create(props: { id: string; title: string; contexts: string[] }): void;
    removeAll(): Promise<void>;
    onClicked: { addListener(cb: (info: { menuItemId: string | number; selectionText?: string }) => void): void };
  };
  action: { openPopup?: () => Promise<void> };
  windows: { create(props: { url: string; type: 'popup'; width: number; height: number }): Promise<unknown> };
}

const g = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
export const ext: ExtensionApi = (g.browser ?? g.chrome)!;

/** Session storage (memory only) where available, so selected text never lands on disk. */
export const shortTerm: StorageArea = ext.storage.session ?? ext.storage.local;

export async function getApiKey(): Promise<string | undefined> {
  const { apiKey } = await ext.storage.local.get('apiKey');
  return typeof apiKey === 'string' && apiKey ? apiKey : undefined;
}

export function setApiKey(apiKey: string | null): Promise<void> {
  return apiKey ? ext.storage.local.set({ apiKey }) : ext.storage.local.remove('apiKey');
}
