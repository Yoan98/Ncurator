import 'webextension-polyfill';
import { IndexDBStore, globalConstant } from '@extension/shared';

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

chrome.runtime.onConnect.addListener(function (port) {
    if (port.name === 'mySidepanel') {
        port.onDisconnect.addListener(async () => {
            // 检查indexdb是否有building的数据,如果有则统一设为fail
            const store = new IndexDBStore();
            await store.connect(globalConstant.DEFAULT_INDEXDB_NAME);

            const updateDoc = (cursor: IDBCursorWithValue) => {
                const doc = cursor.value;
                if (doc.status === globalConstant.DocumentStatus.Building) {
                    doc.status = globalConstant.DocumentStatus.Fail;
                    cursor.update(doc);
                }
            }
            store.startCursor({
                storeName: globalConstant.DOCUMENT_STORE_NAME,
                transactionMode: 'readwrite',
                cb: updateDoc
            }).catch((error) => console.error(error));
        });
    }
});