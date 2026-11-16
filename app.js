(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const moods = { fresh: 'С чистого листа', bold: 'В центре внимания', soft: 'Нежнее нежного', night: 'После заката' };
  const plural = (count, words = ['аромат', 'аромата', 'ароматов']) => {
    const n = Math.abs(count) % 100;
    return count + ' ' + words[n > 10 && n < 20 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
  };
  const storage = {
    read(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* In-memory state remains available in opaque previews. */ } }
  };
  const savedFavorites = storage.read('letu-editorial-favorites-v1', []);
  const savedCart = storage.read('letu-editorial-cart-v1', {});
  let favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.map(String) : []);
  let cart = savedCart && typeof savedCart === 'object' && !Array.isArray(savedCart) ? { ...savedCart } : {};
  let products = [];
  let loadingFailed = false;
  let quickProductId = null;
  let toastTimer;
  let lastDialogTrigger = null;
  let lastDialogProductId = null;
  let quizStep = 1;
  let quizMood = null;
  let quizBudget = null;
  const state = { search: '', mood: null, maxPrice: null, brands: new Set(), favoritesOnly: false, sort: 'editorial' };

  function sourceUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (_) { return ''; }
  }
  function imageMarkup(product, className = '', eager = false) {
    return `<img class="${className}" src="${escape(product.image)}" alt="${escape(product.brand + ' ' + product.name + ' — флакон')}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
  }
  function handleImageErrors(root = document) {
    $$('img:not([data-error-ready])', root).forEach(img => {
      img.dataset.errorReady = 'true';
      const fallback = () => {
        if (img.classList.contains('hero-image')) { img.hidden = true; return; }
        const placeholder = document.createElement('span');
        placeholder.className = 'image-placeholder';
        placeholder.textContent = 'Фото недоступно';
        img.replaceWith(placeholder);
      };
      img.addEventListener('error', fallback, { once: true });
      if (img.complete && img.naturalWidth === 0) fallback();
    });
  }
  function save() {
    storage.write('letu-editorial-favorites-v1', [...favorites]);
    storage.write('letu-editorial-cart-v1', cart);
  }
  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = $('#toast');
    toast.innerHTML = icon('check') + escape(message);
    toast.hidden = false;
    const openDialog = $('dialog[open]');
    // A dialog is in the top layer; placing feedback inside it keeps it visible.
    (openDialog || document.body).append(toast);
    toastTimer = setTimeout(() => { toast.hidden = true; document.body.append(toast); }, 3400);
  }
  function scrollToCatalog() {
    $('#catalog').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  function showDialog(dialog, trigger) {
    if (!dialog) return;
    $$('dialog[open]').forEach(other => other.close());
    lastDialogTrigger = trigger || document.activeElement;
    lastDialogProductId = lastDialogTrigger?.dataset?.quick || null;
    dialog.showModal();
    document.body.classList.add('modal-open');
  }
  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-close-dialog]')) closeDialog(dialog);
      if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
      }
    });
    dialog.addEventListener('close', () => {
      if (!$('dialog[open]')) {
        document.body.classList.remove('modal-open');
        const returnTarget = lastDialogTrigger?.isConnected ? lastDialogTrigger : $$('[data-quick]', $('#product-grid')).find(button => button.dataset.quick === lastDialogProductId) || $('#all-filter');
        returnTarget?.focus({ preventScroll: true });
      }
      const toast = $('#toast');
      if (toast && dialog.contains(toast)) { toast.hidden = true; document.body.append(toast); }
    });
  });

  function filteredProducts(filters = state) {
    const query = filters.search.trim().toLocaleLowerCase('ru');
    const terms = query.split(/\s+/).filter(Boolean);
    return products.filter(product => {
      const haystack = `${product.brand} ${product.name}`.toLocaleLowerCase('ru');
      return terms.every(term => haystack.includes(term))
        && (!filters.mood || product.mood === filters.mood)
        && (filters.maxPrice === null || product.price <= filters.maxPrice)
        && (!filters.brands.size || filters.brands.has(product.brand))
        && (!filters.favoritesOnly || favorites.has(product.id));
    });
  }
  function sortedProducts(items) {
    const result = [...items];
    if (state.sort === 'price-asc') result.sort((a, b) => a.price - b.price);
    else if (state.sort === 'price-desc') result.sort((a, b) => b.price - a.price);
    else if (state.sort === 'brand') result.sort((a, b) => a.brand.localeCompare(b.brand, 'ru') || a.name.localeCompare(b.name, 'ru'));
    return result;
  }
  function productCard(product) {
    const favorite = favorites.has(product.id);
    const number = String(products.indexOf(product) + 1).padStart(2, '0');
    return `<article class="product-card" data-product-id="${escape(product.id)}">
      <div class="product-media"><span class="product-number">N° ${number}</span>
        <button class="product-open" type="button" data-quick="${escape(product.id)}" aria-label="Подробнее: ${escape(product.brand)} ${escape(product.name)}">${imageMarkup(product)}</button>
        <button class="icon-button favorite-button" type="button" data-favorite="${escape(product.id)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Убрать из избранного' : 'Добавить в избранное'}: ${escape(product.name)}">${icon('heart')}</button>
      </div><div class="product-info"><p class="product-brand">${escape(product.brand)}</p><button class="product-name" type="button" data-quick="${escape(product.id)}">${escape(product.name)}</button><p class="product-volume">${escape(product.volume)}</p><div class="product-bottom"><p class="product-price"><span class="price-label">Демо-цена</span>${money(product.price)}</p><button class="product-detail" type="button" data-quick="${escape(product.id)}" aria-label="Подробнее о ${escape(product.brand)} ${escape(product.name)}">Подробнее ${icon('arrow')}</button></div></div></article>`;
  }
  function setPressed(selector, active) {
    const element = $(selector);
    element.classList.toggle('is-active', active);
    element.setAttribute('aria-pressed', String(active));
  }
  function updateHeader() {
    const count = favorites.size;
    $('#favorites-count').textContent = count;
    $('#favorites-count').hidden = !count;
    $('#header-favorites').setAttribute('aria-pressed', String(state.favoritesOnly));
    $('#header-favorites').setAttribute('aria-label', `${state.favoritesOnly ? 'Показать все ароматы' : 'Показать избранное'}${count ? ': ' + count : ''}`);
    const quantity = Object.values(cart).reduce((total, value) => total + value, 0);
    $('#cart-count').textContent = quantity;
    $('#cart-count').hidden = !quantity;
    $('#cart-open').setAttribute('aria-label', `Открыть демо-сумку: ${plural(quantity, ['товар', 'товара', 'товаров'])}`);
  }
  function renderActiveFilters() {
    const filters = [];
    const chip = (type, label, value = '') => `<button class="active-chip" type="button" data-clear-filter="${type}" data-value="${escape(value)}" aria-label="Убрать фильтр: ${escape(label)}">${escape(label)}${icon('close')}</button>`;
    if (state.search) filters.push(chip('search', 'Поиск: ' + state.search));
    if (state.mood) filters.push(chip('mood', moods[state.mood]));
    if (state.maxPrice !== null) filters.push(chip('price', 'До ' + money(state.maxPrice)));
    state.brands.forEach(brand => filters.push(chip('brand', brand, brand)));
    if (state.favoritesOnly) filters.push(chip('favorites', 'Избранное'));
    const container = $('#active-filters');
    container.innerHTML = filters.join('') + (filters.length ? '<button class="reset-link" type="button" data-reset-all>Сбросить всё</button>' : '');
    container.hidden = !filters.length;
  }
  function renderCatalog() {
    const visible = sortedProducts(filteredProducts());
    const grid = $('#product-grid');
    const focusedFavorite = document.activeElement?.dataset.favorite;
    const hadFilters = state.search || state.mood || state.maxPrice !== null || state.brands.size || state.favoritesOnly;
    grid.innerHTML = visible.map(productCard).join('');
    grid.setAttribute('aria-busy', 'false');
    grid.hidden = !visible.length;
    $('#empty-state').hidden = visible.length > 0;
    if (loadingFailed) {
      $('#catalog-count').textContent = 'Каталог временно недоступен';
      $('#empty-message').textContent = 'Не удалось загрузить локальный каталог. Попробуй открыть страницу ещё раз.';
      $('#empty-reset').innerHTML = 'Повторить загрузку ' + icon('right');
    } else {
      $('#catalog-count').textContent = hadFilters ? `Найдено: ${plural(visible.length)} / ${products.length}` : `${plural(products.length)} в твоём распоряжении`;
      $('#empty-message').textContent = state.favoritesOnly && !favorites.size ? 'Сохраняй ароматы сердечком — здесь соберётся твоя личная подборка.' : 'Попробуй другой запрос или дай место новым сочетаниям.';
      $('#empty-reset').innerHTML = 'Сбросить фильтры ' + icon('right');
    }
    setPressed('#all-filter', !hadFilters);
    setPressed('#budget-filter', state.maxPrice === 3000);
    setPressed('#favorites-filter', state.favoritesOnly);
    const filterCount = Number(state.maxPrice !== null) + state.brands.size;
    $('#filter-count').textContent = filterCount;
    $('#filter-count').hidden = !filterCount;
    $$('[data-mood]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mood === state.mood)));
    $('#search-clear').hidden = !state.search;
    renderActiveFilters();
    updateHeader();
    handleImageErrors(grid);
    if (focusedFavorite) {
      const button = $$('[data-favorite]', grid).find(item => item.dataset.favorite === focusedFavorite);
      if (button) button.focus({ preventScroll: true });
      else if (state.favoritesOnly) $('#favorites-filter').focus({ preventScroll: true });
    }
  }
  function resetFilters() {
    state.search = '';
    state.mood = null;
    state.maxPrice = null;
    state.brands.clear();
    state.favoritesOnly = false;
    state.sort = 'editorial';
    $('#search').value = '';
    $('#sort').value = 'editorial';
    renderCatalog();
  }
  function toggleFavorite(id) {
    if (!products.some(product => product.id === id)) return;
    const wasFavorite = favorites.has(id);
    if (wasFavorite) favorites.delete(id); else favorites.add(id);
    save();
    renderCatalog();
    if ($('#quick-dialog').open && quickProductId === id) updateQuickFavorite(id);
    showToast(wasFavorite ? 'Аромат убран из избранного' : 'Аромат сохранён в избранном');
  }
  function updateQuickFavorite(id) {
    const button = $('#quick-favorite');
    if (!button) return;
    const active = favorites.has(id);
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = icon('heart') + (active ? 'В избранном' : 'В избранное');
    button.setAttribute('aria-label', active ? 'Убрать аромат из избранного' : 'Добавить аромат в избранное');
  }
  function openQuick(id, trigger) {
    const product = products.find(item => item.id === id);
    if (!product) return;
    quickProductId = id;
    const source = sourceUrl(product.url);
    $('#quick-content').innerHTML = `<div class="quick-layout"><div class="quick-image">${imageMarkup(product, '', true)}</div><div class="quick-info"><p class="quick-brand">${escape(product.brand)}</p><h2 id="quick-title">${escape(product.name)}</h2><p class="quick-volume">${escape(product.volume)}</p><p class="product-price"><span class="price-label">ДЕМО-ЦЕНА</span>${money(product.price)}</p><p class="quick-description">${product.mood && moods[product.mood] ? `В редакционной подборке «${escape(moods[product.mood])}». ` : ''}Характеристики, доступные объёмы, наличие и стоимость — в оригинальной карточке.</p><div class="quick-actions"><button class="button button-dark" type="button" data-add-cart="${escape(id)}">В демо-сумку ${icon('bag')}</button>${source ? `<a class="quick-source" href="${escape(source)}" target="_blank" rel="noopener noreferrer">Карточка в ЛЭТУАЛЬ ${icon('arrow')}</a>` : ''}</div><div class="quick-secondary"><button class="quick-favorite" id="quick-favorite" type="button" data-favorite="${escape(id)}" aria-pressed="false"></button><span>БЕЗ ОФОРМЛЕНИЯ ПОКУПОК</span></div></div></div>`;
    updateQuickFavorite(id);
    handleImageErrors($('#quick-content'));
    showDialog($('#quick-dialog'), trigger);
  }
  function addToCart(id) {
    if (!products.some(product => product.id === id)) return;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    save();
    updateHeader();
    if ($('#cart-dialog').open) renderCart();
    const button = $('[data-add-cart]', $('#quick-dialog'));
    if (button) button.innerHTML = `В демо-сумке · ${cart[id]} ${icon('check')}`;
    showToast('Добавлено в демо-сумку. Оформление недоступно.');
  }
  function renderCart() {
    const entries = Object.entries(cart).map(([id, quantity]) => ({ product: products.find(item => item.id === id), quantity })).filter(item => item.product && item.quantity > 0);
    const count = entries.reduce((sum, item) => sum + item.quantity, 0);
    $('#cart-title-count').textContent = '/ ' + count;
    $('#cart-summary').hidden = !entries.length;
    if (!entries.length) {
      $('#cart-items').innerHTML = `<div class="cart-empty">${icon('bag')}<h3>Здесь место для открытий</h3><p>Добавь аромат в демо-сумку, чтобы собрать свою коллекцию.</p><button class="button button-dark" type="button" data-close-dialog>Выбрать аромат ${icon('arrow')}</button></div>`;
      return;
    }
    $('#cart-items').innerHTML = entries.map(({ product, quantity }) => `<article class="cart-item" data-cart-id="${escape(product.id)}"><div class="cart-item-image">${imageMarkup(product, '', true)}</div><div class="cart-item-info"><p class="cart-item-brand">${escape(product.brand)}</p><span class="cart-item-name">${escape(product.name)}</span><p class="cart-item-price">${money(product.price * quantity)} <span class="price-label">Демо · ${money(product.price)} / шт.</span></p><div class="cart-item-controls"><div class="quantity-control"><button type="button" data-cart-change="-1" data-id="${escape(product.id)}" aria-label="Уменьшить количество: ${escape(product.name)}">${icon('minus')}</button><span aria-label="Количество">${quantity}</span><button type="button" data-cart-change="1" data-id="${escape(product.id)}" aria-label="Увеличить количество: ${escape(product.name)}" ${quantity >= 99 ? 'disabled' : ''}>${icon('plus')}</button></div><button class="remove-item" type="button" data-cart-remove="${escape(product.id)}" aria-label="Убрать из демо-сумки: ${escape(product.name)}">Убрать</button></div></div></article>`).join('');
    $('#cart-total').textContent = money(entries.reduce((sum, item) => sum + item.product.price * item.quantity, 0));
    handleImageErrors($('#cart-items'));
  }
  function openCart(trigger) {
    renderCart();
    showDialog($('#cart-dialog'), trigger);
  }
  function changeCart(id, change, remove = false) {
    const active = document.activeElement;
    const action = active?.dataset.cartChange;
    const currentScroll = $('#cart-items').scrollTop;
    if (remove) delete cart[id];
    else {
      cart[id] = Math.min(99, Math.max(0, (cart[id] || 0) + change));
      if (!cart[id]) delete cart[id];
    }
    save();
    renderCart();
    updateHeader();
    $('#cart-items').scrollTop = currentScroll;
    const sameAction = $$('[data-cart-change]', $('#cart-items')).find(button => button.dataset.id === id && button.dataset.cartChange === action);
    if (sameAction && !sameAction.disabled) sameAction.focus({ preventScroll: true });
    else ($('[data-cart-change]', $('#cart-items')) || $('[data-close-dialog]', $('#cart-dialog'))).focus({ preventScroll: true });
  }
  function buildBrandOptions() {
    const brands = [...new Set(products.map(item => item.brand))].sort((a, b) => a.localeCompare(b, 'ru'));
    $('#brand-options').innerHTML = brands.map(brand => `<label class="brand-option"><input type="checkbox" name="brand" value="${escape(brand)}"><span>${escape(brand)}</span><span>${products.filter(item => item.brand === brand).length}</span></label>`).join('');
  }
  function filterDraft() {
    const value = $('#max-price').value.trim();
    return { ...state, maxPrice: value !== '' ? Math.max(0, Number(value)) : null, brands: new Set($$('input[name="brand"]:checked', $('#filter-form')).map(input => input.value)) };
  }
  function updateDraftCount() {
    const count = filteredProducts(filterDraft()).length;
    $('#filter-apply').innerHTML = `Показать: ${plural(count)} ${icon('arrow')}`;
  }
  function openFilters(trigger) {
    $('#max-price').value = state.maxPrice ?? '';
    $$('input[name="brand"]', $('#filter-form')).forEach(input => { input.checked = state.brands.has(input.value); });
    updateDraftCount();
    showDialog($('#filter-dialog'), trigger);
  }
  function openQuiz(trigger) {
    quizStep = 1;
    quizMood = state.mood;
    quizBudget = state.maxPrice;
    renderQuiz();
    showDialog($('#quiz-dialog'), trigger);
  }
  function renderQuiz() {
    const isMood = quizStep === 1;
    const choices = isMood ? Object.entries(moods) : [['any', 'Без ограничений'], ['3000', 'До 3 000 ₽'], ['5000', 'До 5 000 ₽'], ['8000', 'До 8 000 ₽']];
    const selected = isMood ? quizMood : String(quizBudget ?? 'any');
    $('#quiz-content').innerHTML = `<div class="quiz-kicker">ЛИЧНОЕ ЗНАКОМСТВО <span class="step-line"></span> ${quizStep} / 2</div><h2 id="quiz-title">${isMood ? 'С какого настроения начнём?' : 'Какой бюджет комфортен?'}</h2><p class="quiz-description">${isMood ? 'Выбери то, что откликается сейчас. Это только начало знакомства.' : 'Ориентируемся на демонстрационные цены этого каталога.'}</p><div class="quiz-options">${choices.map(([value, label]) => `<button class="quiz-choice ${selected === value ? 'is-selected' : ''}" type="button" data-quiz-choice="${escape(value)}" aria-pressed="${selected === value}">${escape(label)}${icon('check')}</button>`).join('')}</div><div class="quiz-footer"><button class="text-link" type="button" id="quiz-back">${isMood ? 'Любое настроение' : 'Назад'}</button><button class="button button-dark" type="button" id="quiz-next">${isMood ? 'Дальше' : 'Смотреть подборку'} ${icon('arrow')}</button></div><p class="quiz-editorial-note">Редакционная подборка по настроению, без обещаний нот или эффекта. Состав и характеристики — на letu.ru.</p>`;
  }
  function finishQuiz() {
    // A new editorial selection starts without old search/brand/favorite constraints.
    resetFilters();
    state.mood = quizMood;
    state.maxPrice = quizBudget;
    renderCatalog();
    closeDialog($('#quiz-dialog'));
    scrollToCatalog();
    showToast(`Твоя подборка: ${plural(filteredProducts().length)}. Можно уточнить фильтры.`);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target.closest('#main-nav')) {
      $('#main-nav').classList.remove('is-open');
      $('#menu-toggle').setAttribute('aria-expanded', 'false');
      $('#menu-toggle').setAttribute('aria-label', 'Открыть меню');
    }
    if (target.dataset.favorite) { toggleFavorite(target.dataset.favorite); return; }
    if (target.dataset.quick) { openQuick(target.dataset.quick, target); return; }
    if (target.dataset.addCart) { addToCart(target.dataset.addCart); return; }
    if (target.hasAttribute('data-open-quiz')) { openQuiz(target); return; }
    if (target.hasAttribute('data-mood')) {
      state.mood = state.mood === target.dataset.mood ? null : target.dataset.mood;
      renderCatalog(); scrollToCatalog(); return;
    }
    if (target.hasAttribute('data-cart-remove')) { changeCart(target.dataset.cartRemove, 0, true); return; }
    if (target.hasAttribute('data-cart-change')) { changeCart(target.dataset.id, Number(target.dataset.cartChange)); return; }
    if (target.hasAttribute('data-clear-filter')) {
      switch (target.dataset.clearFilter) {
        case 'search': state.search = ''; $('#search').value = ''; break;
        case 'mood': state.mood = null; break;
        case 'price': state.maxPrice = null; break;
        case 'brand': state.brands.delete(target.dataset.value); break;
        case 'favorites': state.favoritesOnly = false; break;
      }
      renderCatalog(); return;
    }
    if (target.hasAttribute('data-reset-all')) { resetFilters(); return; }
    if (target.hasAttribute('data-reset-catalog')) resetFilters();
    if (target.hasAttribute('data-budget-link')) { state.maxPrice = 3000; renderCatalog(); }
    if (target.hasAttribute('data-quiz-choice')) {
      if (quizStep === 1) quizMood = target.dataset.quizChoice;
      else quizBudget = target.dataset.quizChoice === 'any' ? null : Number(target.dataset.quizChoice);
      $$('.quiz-choice', $('#quiz-content')).forEach(button => {
        const active = button === target;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      });
      return;
    }
    if (target.id === 'quiz-next') {
      if (quizStep === 1) { quizStep = 2; renderQuiz(); $('#quiz-title').setAttribute('tabindex', '-1'); $('#quiz-title').focus(); }
      else finishQuiz();
      return;
    }
    if (target.id === 'quiz-back') {
      if (quizStep === 1) { quizMood = null; quizStep = 2; }
      else quizStep = 1;
      renderQuiz(); $('#quiz-title').setAttribute('tabindex', '-1'); $('#quiz-title').focus(); return;
    }
    if (target.closest('#main-nav') || target.closest('.site-footer')) {
      $('#main-nav').classList.remove('is-open');
      $('#menu-toggle').setAttribute('aria-expanded', 'false');
      $('#menu-toggle').setAttribute('aria-label', 'Открыть меню');
    }
  });
  $('#search').addEventListener('input', event => { state.search = event.target.value; renderCatalog(); });
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); scrollToCatalog(); });
  $('#search-clear').addEventListener('click', () => { state.search = ''; $('#search').value = ''; renderCatalog(); $('#search').focus(); });
  $('#sort').addEventListener('change', event => { state.sort = event.target.value; renderCatalog(); });
  $('#all-filter').addEventListener('click', resetFilters);
  $('#budget-filter').addEventListener('click', () => { state.maxPrice = state.maxPrice === 3000 ? null : 3000; renderCatalog(); });
  $('#favorites-filter').addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; renderCatalog(); });
  $('#header-favorites').addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; renderCatalog(); scrollToCatalog(); });
  $('#empty-reset').addEventListener('click', () => { if (loadingFailed) loadProducts(); else resetFilters(); });
  $('#cart-open').addEventListener('click', event => openCart(event.currentTarget));
  $('#filter-open').addEventListener('click', event => openFilters(event.currentTarget));
  $('#filter-form').addEventListener('input', updateDraftCount);
  $('#filter-form').addEventListener('submit', event => {
    event.preventDefault();
    const draft = filterDraft();
    state.maxPrice = draft.maxPrice;
    state.brands = draft.brands;
    renderCatalog(); closeDialog($('#filter-dialog')); scrollToCatalog();
  });
  $('#filter-reset').addEventListener('click', () => { resetFilters(); closeDialog($('#filter-dialog')); });
  $('#menu-toggle').addEventListener('click', () => {
    const open = $('#main-nav').classList.toggle('is-open');
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
    $('#menu-toggle').setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#main-nav').classList.contains('is-open') && !$('dialog[open]')) {
      $('#main-nav').classList.remove('is-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); $('#menu-toggle').setAttribute('aria-label', 'Открыть меню'); $('#menu-toggle').focus();
    }
  });
  async function loadProducts() {
    $('#product-grid').setAttribute('aria-busy', 'true');
    loadingFailed = false;
    try {
      let data = Array.isArray(window.LETU_PRODUCTS) ? window.LETU_PRODUCTS : null;
      if (!data?.length) {
        try { const inline = JSON.parse($('#product-data')?.textContent || '[]'); if (Array.isArray(inline) && inline.length) data = inline; } catch (_) { /* Fetch remains available as a fallback. */ }
      }
      if (!data?.length) {
        const response = await fetch('./products.json');
        if (!response.ok) throw new Error('Product data unavailable');
        data = await response.json();
      }
      if (!Array.isArray(data)) throw new Error('Expected a product array');
      const seen = new Set();
      products = data.filter(item => item && item.id != null && item.brand && item.name && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 && !seen.has(String(item.id)) && seen.add(String(item.id))).map(item => ({ ...item, id: String(item.id), brand: String(item.brand), name: String(item.name), price: Number(item.price), volume: String(item.volume || 'Объём — на сайте'), image: String(item.image || ''), mood: moods[item.mood] ? item.mood : null }));
      if (!products.length) throw new Error('Product catalogue is empty');
      const ids = new Set(products.map(item => item.id));
      favorites = new Set([...favorites].filter(id => ids.has(id)));
      cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) => ids.has(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 99));
      save();
      buildBrandOptions();
    } catch (_) {
      loadingFailed = true;
      products = [];
    }
    renderCatalog();
  }
  handleImageErrors();
  loadProducts();
})();
