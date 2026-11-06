/** Shared searchable library view used by History and Favorites. */
import { getLanguage, t } from './i18n.js';
import { navigate } from './router.js';
import {
  bindRecordCards, hydrateThumbs, renderRecordCard
} from './records.js';
import {
  applyIcons, confirmDialog, emptyState, toast
} from './ui.js';
import { escapeHtml, formatNumber } from './utils.js';

const ALL_TYPES = ['url', 'text', 'wifi', 'email', 'phone', 'sms', 'vcard', 'location'];

function sortRecords(records, sort, lang, timeField) {
  const copy = records.slice();
  if (sort === 'oldest') return copy.sort((a, b) => timeField(a) - timeField(b));
  if (sort === 'label') {
    return copy.sort((a, b) => String(a.label).localeCompare(String(b.label), lang));
  }
  if (sort === 'type') {
    return copy.sort((a, b) => (
      String(a.type).localeCompare(String(b.type), lang)
      || String(a.label).localeCompare(String(b.label), lang)
    ));
  }
  return copy.sort((a, b) => timeField(b) - timeField(a));
}

export function mountLibraryView(view, ctx, config) {
  const lang = getLanguage();
  const state = config.state;
  let disposeCards = null;
  let disposeThumbs = null;
  let lastLocalChange = 0;
  let contentEl = null;

  const filtered = () => {
    const records = config.getRecords();
    const query = state.query.trim().toLocaleLowerCase(lang === 'ar' ? 'ar' : 'en');
    const list = records.filter((record) => {
      if (state.type !== 'all' && record.type !== state.type) return false;
      if (!query) return true;
      const haystack = `${record.label} ${record.payload} ${record.type} ${t(`types.${record.type}`)}`
        .toLocaleLowerCase(lang === 'ar' ? 'ar' : 'en');
      return haystack.includes(query);
    });
    return { all: records, list: sortRecords(list, state.sort, lang, config.timeField) };
  };

  function emptyMarkup(all) {
    if (!all.length) {
      return emptyState({
        icon: config.emptyIcon || 'qr-code',
        title: t(`${config.key}.emptyTitle`),
        description: t(`${config.key}.emptyDesc`),
        action: `<button type="button" class="btn btn-primary btn-sm" data-empty-action>
          <i class="icon" data-lucide="${config.emptyActionIcon || 'sparkles'}"></i>
          <span>${escapeHtml(t(`${config.key}.emptyAction`))}</span>
        </button>`
      });
    }
    return emptyState({
      icon: 'search',
      title: t(`${config.key}.noResults`),
      description: t(`${config.key}.noResultsDesc`)
    });
  }

  function renderList() {
    if (!contentEl) return;
    const { all, list } = filtered();
    disposeCards?.();
    disposeThumbs?.();
    disposeCards = null;
    disposeThumbs = null;

    const countEl = view.querySelector('[data-library-count]');
    if (countEl) {
      countEl.textContent = t(`${config.key}.count`, {
        count: formatNumber(list.length, lang),
        total: formatNumber(all.length, lang)
      });
    }

    const clearButton = view.querySelector('[data-library-clear]');
    if (clearButton) clearButton.hidden = all.length === 0;

    if (!list.length) {
      contentEl.innerHTML = emptyMarkup(all);
      applyIcons(contentEl);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'record-grid';
    grid.innerHTML = list.map((record) => renderRecordCard(record, {
      removeIcon: config.removeIcon,
      removeLabel: config.removeLabel
    })).join('');
    contentEl.replaceChildren(grid);
    applyIcons(grid);

    disposeCards = bindRecordCards(grid, list, {
      context: config.removeContext,
      onChanged: () => {
        lastLocalChange = Date.now();
        renderList();
      },
      onRemoved: () => {
        lastLocalChange = Date.now();
        renderList();
      }
    });
    disposeThumbs = hydrateThumbs(grid, list, { signal: ctx.signal });
  }

  function renderAll() {
    const { all } = filtered();
    view.innerHTML = `<div class="library-view view-enter">
      <div class="page-intro">
        <div>
          <h2>${escapeHtml(t(`${config.key}.title`))}</h2>
          <p>${escapeHtml(t(`${config.key}.subtitle`))}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-danger btn-sm" data-library-clear ${all.length ? '' : 'hidden'}>
            <i class="icon" data-lucide="trash-2"></i>
            <span>${escapeHtml(t(`${config.key}.clearAll`))}</span>
          </button>
        </div>
      </div>
      <div class="toolbar">
        <div class="search-field">
          <i class="icon" data-lucide="search"></i>
          <input type="search" class="input" data-library-search value="${escapeHtml(state.query)}"
            placeholder="${escapeHtml(t(`${config.key}.searchPlaceholder`))}"
            aria-label="${escapeHtml(t('common.search'))}" autocomplete="off">
        </div>
        <div class="select-wrap toolbar-select">
          <select class="select" data-library-type aria-label="${escapeHtml(t('common.type'))}">
            <option value="all">${escapeHtml(t(`${config.key}.filterAll`))}</option>
            ${ALL_TYPES.map((type) => `<option value="${type}" ${state.type === type ? 'selected' : ''}>${escapeHtml(t(`types.${type}`))}</option>`).join('')}
          </select>
          <i class="icon" data-lucide="chevrons-up-down"></i>
        </div>
        <div class="select-wrap toolbar-select">
          <select class="select" data-library-sort aria-label="${escapeHtml(t('common.actions'))}">
            <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>${escapeHtml(t(`${config.key}.sortNewest`))}</option>
            <option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>${escapeHtml(t(`${config.key}.sortOldest`))}</option>
            <option value="label" ${state.sort === 'label' ? 'selected' : ''}>${escapeHtml(t(`${config.key}.sortLabel`))}</option>
            <option value="type" ${state.sort === 'type' ? 'selected' : ''}>${escapeHtml(t(`${config.key}.sortType`))}</option>
          </select>
          <i class="icon" data-lucide="chevrons-up-down"></i>
        </div>
        <span class="toolbar-meta" data-library-count></span>
      </div>
      <div data-library-content></div>
    </div>`;

    applyIcons(view);
    contentEl = view.querySelector('[data-library-content]');

    const search = view.querySelector('[data-library-search]');
    search?.addEventListener('input', () => {
      state.query = search.value;
      renderList();
    });

    view.querySelector('[data-library-type]')?.addEventListener('change', (event) => {
      state.type = event.currentTarget.value;
      renderList();
    });

    view.querySelector('[data-library-sort]')?.addEventListener('change', (event) => {
      state.sort = event.currentTarget.value;
      renderList();
    });

    view.querySelector('[data-library-clear]')?.addEventListener('click', async () => {
      const snapshot = config.getRecords().slice();
      if (!snapshot.length) return;
      const confirmed = await confirmDialog({
        title: t(`${config.key}.clearTitle`),
        message: t(`${config.key}.clearMessage`),
        confirmLabel: t(`${config.key}.clearAll`),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'trash-2',
        checkboxLabel: t(`${config.key}.clearCheck`)
      });
      if (!confirmed) return;
      config.clear();
      state.query = '';
      state.type = 'all';
      state.sort = config.defaultSort;
      toast(t('toast.cleared'), {
        type: 'success',
        actionLabel: t('common.undo'),
        duration: 7000,
        onAction: () => {
          config.restoreAll(snapshot);
          lastLocalChange = Date.now();
          renderAll();
          toast(t('toast.restored'), { type: 'success' });
        }
      });
      lastLocalChange = Date.now();
      renderAll();
    });

    contentEl.addEventListener('click', (event) => {
      if (!event.target.closest('[data-empty-action]')) return;
      navigate(config.emptyActionRoute || 'generator');
    });

    renderList();
  }

  const onStateChange = () => {
    if (Date.now() - lastLocalChange < 140) return;
    renderList();
  };
  window.addEventListener('qs:state-changed', onStateChange);

  renderAll();

  return () => {
    window.removeEventListener('qs:state-changed', onStateChange);
    disposeCards?.();
    disposeThumbs?.();
  };
}
