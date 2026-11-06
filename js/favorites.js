/** Favorites library view. */
import { mountLibraryView } from './library-view.js';
import { clearFavorites, getFavorites, restoreFavorite } from './storage.js';

const state = { query: '', type: 'all', sort: 'newest' };

function restoreAll(records) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    restoreFavorite(records[i], 0);
  }
}

export default function favoritesView(view, ctx) {
  return mountLibraryView(view, ctx, {
    key: 'favorites',
    state,
    getRecords: getFavorites,
    timeField: (record) => record.favoritedAt || record.updatedAt || record.createdAt,
    removeContext: 'favorites',
    removeIcon: 'star',
    removeLabel: 'favorites.delete',
    defaultSort: 'newest',
    clear: clearFavorites,
    restoreAll,
    emptyActionRoute: 'history',
    emptyIcon: 'star',
    emptyActionIcon: 'history'
  });
}
