/** History library view. */
import { mountLibraryView } from './library-view.js';
import { clearHistory, getHistory, restoreHistory } from './storage.js';

const state = { query: '', type: 'all', sort: 'newest' };

function restoreAll(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    restoreHistory(records[i], 0);
  }
}

export default function historyView(view, ctx) {
  return mountLibraryView(view, ctx, {
    key: 'history',
    state,
    getRecords: getHistory,
    timeField: (record) => record.updatedAt || record.createdAt,
    removeContext: 'history',
    removeIcon: 'trash-2',
    removeLabel: 'common.delete',
    defaultSort: 'newest',
    clear: clearHistory,
    restoreAll,
    emptyActionRoute: 'generator',
    emptyIcon: 'history',
    emptyActionIcon: 'sparkles'
  });
}
