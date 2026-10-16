/** Right-click → "Send as a Vanishnote": opens the popup with the selected text filled in. */
import { ext, shortTerm } from './ext';

const MENU_ID = 'vanishnote-send-selection';

async function createMenu(): Promise<void> {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({ id: MENU_ID, title: 'Send as a self-destructing Vanishnote', contexts: ['selection'] });
}
void createMenu();

ext.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  // Kept in memory-only session storage until the popup reads (and deletes) it.
  void shortTerm.set({ selection: info.selectionText }).then(async () => {
    try {
      if (!ext.action.openPopup) throw new Error('no openPopup');
      await ext.action.openPopup();
    } catch {
      await ext.windows.create({ url: ext.runtime.getURL('popup.html'), type: 'popup', width: 420, height: 680 });
    }
  });
});
