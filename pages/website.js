// Website: the announcement banner, deals and holiday hours shown on usafuelandmart.com.

import * as calc from '../calc.js';
import { esc, pill, toast, field, selectField, newId, mediumDate } from '../ui.js';

// Sample deals the owner can start from. The website shows no deals until some are saved here.
const EXAMPLE_DEALS = [
  { tag: 'Fill-up perk', title: "Fill up. Coffee's on us.", text: 'Pump 10 gallons or more and grab a free hot coffee inside.', featured: true },
  { tag: 'Every week', title: 'Combo of the Week', text: 'A new snack and drink combo every week. Ask at the register.' },
  { tag: 'Rewards', title: 'Coffee Club', text: 'Buy 9 coffees and your 10th is free. Ask for a punch card.' },
  { tag: 'Now open', title: 'Grand Opening', text: "We're new on Fulton St. Stop in for opening-month specials." },
];

function dealCard(deal, index, count) {
  return `<fieldset class="deal-edit" data-deal="${esc(deal.id)}">
    <legend>Deal ${index + 1}${deal.featured ? ' · featured' : ''}</legend>
    <div class="fields">
      ${field({ name: 'title', label: 'Headline', type: 'text', value: deal.title, placeholder: "Fill up. Coffee's on us." })}
      ${field({ name: 'tag', label: 'Small label', type: 'text', value: deal.tag, placeholder: 'Fill-up perk' })}
      ${field({ name: 'text', label: 'Details', type: 'text', value: deal.text, wide: true, placeholder: 'Pump 10 gallons or more and grab a free hot coffee inside.' })}
      ${field({ name: 'start', label: 'Starts', type: 'date', value: deal.start, hint: 'Blank = now' })}
      ${field({ name: 'end', label: 'Ends', type: 'date', value: deal.end, hint: 'Blank = until you remove it' })}
    </div>
    <div class="deal-edit__options">
      <label class="check"><input type="checkbox" name="featured" ${deal.featured ? 'checked' : ''}> Feature it (big red card)</label>
      <label class="check"><input type="checkbox" name="active" ${deal.active !== false ? 'checked' : ''}> Show on the website</label>
      <span class="toolbar__spacer"></span>
      <button class="btn btn--ghost btn--small" type="button" data-move="-1" ${index === 0 ? 'disabled' : ''}>Move up</button>
      <button class="btn btn--ghost btn--small" type="button" data-move="1" ${index === count - 1 ? 'disabled' : ''}>Move down</button>
      <button class="btn btn--danger btn--small" type="button" data-remove>Remove</button>
    </div>
  </fieldset>`;
}

function holidayRow(h) {
  return `<div class="holiday-row" data-holiday="${esc(h.id)}">
    ${field({ name: 'date', label: 'Date', type: 'date', value: h.date })}
    ${field({ name: 'name', label: 'Holiday', type: 'text', value: h.name, placeholder: 'Thanksgiving' })}
    ${selectField({ name: 'closed', label: 'Hours', value: h.closed ? 'closed' : 'open', options: [['open', 'Open, special hours'], ['closed', 'Closed all day']] })}
    ${field({ name: 'open', label: 'Opens', type: 'time', value: h.open || '06:00' })}
    ${field({ name: 'close', label: 'Closes', type: 'time', value: h.close || '22:00' })}
    <button class="btn btn--ghost btn--small" type="button" data-remove-holiday>Remove</button>
  </div>`;
}

export function renderWebsite(ctx) {
  const today = calc.todayInNewYork();
  const content = ctx.data.content || {};
  const announcement = { active: false, message: '', tone: 'info', start: '', end: '', ...content.announcement };
  let deals = structuredClone(content.deals?.items || []);
  let holidays = structuredClone(content.holiday_hours?.items || []).sort((a, b) => a.date.localeCompare(b.date));
  const liveDeals = calc.activeDeals(content, today);

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Website</p><h1>usafuelandmart.com</h1></div>
      <div class="page-head__actions"><a class="btn btn--ghost" href="https://usafuelandmart.com" target="_blank" rel="noopener">Open the website</a></div>
    </header>
    <p class="intro">Changes here show up on the website within a minute, once the website update that reads them is published. Google Maps and Search show the hours from your Google Business Profile, so update holiday hours there too.</p>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Announcement banner</h2>
        ${announcement.active && announcement.message ? pill('good', 'Showing') : pill('idle', 'Off')}
      </div>
      <p class="card__hint">A strip across the top of every page. Keep it short, for example "Diesel is back in stock" or "Closing at 6 PM on Christmas Eve."</p>
      <form data-announcement novalidate>
        <div class="fields">
          ${field({ name: 'message', label: 'Message', type: 'text', value: announcement.message, wide: true, attrs: 'maxlength="140"' })}
          ${selectField({ name: 'tone', label: 'Style', value: announcement.tone, options: [['info', 'Navy (news)'], ['alert', 'Red (important)']] })}
          ${field({ name: 'start', label: 'Show from', type: 'date', value: announcement.start, hint: 'Blank = now' })}
          ${field({ name: 'end', label: 'Show until', type: 'date', value: announcement.end, hint: 'Blank = until you turn it off' })}
        </div>
        <label class="check"><input type="checkbox" name="active" ${announcement.active ? 'checked' : ''}> Show the banner</label>
        <div class="announce-preview" data-preview></div>
        <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Save banner</button></div>
      </form>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Deals</h2>
        <span class="muted">${content.deals ? `${liveDeals.length} showing today` : 'Hidden on the website'}</span>
      </div>
      <p class="card__hint">Shown in the Deals section of the home page, in this order. If none are showing, the section is hidden.</p>
      ${content.deals ? '' : `<div class="banner">${pill('idle', 'Not set up')}<p>The Deals section is hidden on the website until you save at least one deal here. <button class="btn btn--ghost btn--small" type="button" data-use-examples>Start from sample deals</button></p></div>`}
      <form data-deals novalidate>
        <div data-deal-list></div>
        <div class="button-row form-actions">
          <button class="btn btn--ghost" type="button" data-add-deal>Add a deal</button>
          <span class="toolbar__spacer"></span>
          <button class="btn btn--primary" type="submit">Save deals</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h2 class="card__title">Holiday hours</h2>
      <p class="card__hint">Days with different hours. The website's "Open now" badge follows them, and upcoming ones show in your hours.</p>
      <form data-holidays novalidate>
        <div data-holiday-list></div>
        <div class="button-row form-actions">
          <button class="btn btn--ghost" type="button" data-add-holiday>Add a day</button>
          <span class="toolbar__spacer"></span>
          <button class="btn btn--primary" type="submit">Save holiday hours</button>
        </div>
      </form>
    </section>`;

  // ---- Announcement ----
  const announceForm = ctx.view.querySelector('[data-announcement]');
  const preview = ctx.view.querySelector('[data-preview]');
  const showPreview = () => {
    const message = announceForm.elements.message.value.trim();
    preview.className = `announce-preview announce-preview--${announceForm.elements.tone.value}`;
    preview.textContent = message || 'Your message will look like this.';
  };
  announceForm.addEventListener('input', () => { ctx.markUnsaved(); showPreview(); });
  showPreview();
  announceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = announceForm.elements;
    const data = { active: f.active.checked, message: f.message.value.trim(), tone: f.tone.value, start: f.start.value, end: f.end.value };
    if (data.active && !data.message) return alert('Write a message, or untick "Show the banner".');
    if (await ctx.saveContent('announcement', data)) {
      ctx.markUnsaved(false);
      toast(data.active ? 'Banner saved' : 'Banner turned off');
      ctx.rerender();
    }
  });

  // ---- Deals ----
  const dealList = ctx.view.querySelector('[data-deal-list]');
  const readDeals = () => [...dealList.querySelectorAll('[data-deal]')].map((box) => {
    const get = (name) => box.querySelector(`[name="${name}"]`);
    return {
      id: box.dataset.deal,
      title: get('title').value.trim(),
      tag: get('tag').value.trim(),
      text: get('text').value.trim(),
      start: get('start').value,
      end: get('end').value,
      featured: get('featured').checked,
      active: get('active').checked,
    };
  });
  const drawDeals = () => {
    dealList.innerHTML = deals.length
      ? deals.map((d, i) => dealCard(d, i, deals.length)).join('')
      : '<p class="empty">No deals yet. Click Add a deal.</p>';
  };
  drawDeals();
  dealList.addEventListener('input', () => ctx.markUnsaved());
  dealList.addEventListener('click', (event) => {
    const box = event.target.closest('[data-deal]');
    if (!box) return;
    deals = readDeals();
    const index = deals.findIndex((d) => d.id === box.dataset.deal);
    if (event.target.closest('[data-remove]')) {
      deals.splice(index, 1);
    } else if (event.target.closest('[data-move]')) {
      const to = index + Number(event.target.closest('[data-move]').dataset.move);
      [deals[index], deals[to]] = [deals[to], deals[index]];
    } else {
      return;
    }
    ctx.markUnsaved();
    drawDeals();
  });
  ctx.view.querySelector('[data-add-deal]').addEventListener('click', () => {
    deals = [...readDeals(), { id: newId(), title: '', tag: '', text: '', start: '', end: '', featured: false, active: true }];
    ctx.markUnsaved();
    drawDeals();
    dealList.lastElementChild.querySelector('input').focus();
  });
  ctx.view.querySelector('[data-use-examples]')?.addEventListener('click', (event) => {
    deals = [...readDeals(), ...EXAMPLE_DEALS.map((d) => ({ id: newId(), start: '', end: '', featured: false, active: true, ...d }))];
    event.currentTarget.closest('.banner').remove();
    ctx.markUnsaved();
    drawDeals();
  });
  ctx.view.querySelector('[data-deals]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = readDeals();
    if (items.some((d) => !d.title)) return alert('Every deal needs a headline. Remove empty ones.');
    if (items.some((d) => d.start && d.end && d.end < d.start)) return alert('A deal ends before it starts. Check the dates.');
    if (await ctx.saveContent('deals', { items })) {
      ctx.markUnsaved(false);
      toast('Deals saved');
      ctx.rerender();
    }
  });

  // ---- Holiday hours ----
  const holidayList = ctx.view.querySelector('[data-holiday-list]');
  const readHolidays = () => [...holidayList.querySelectorAll('[data-holiday]')].map((row) => {
    const get = (name) => row.querySelector(`[name="${name}"]`).value;
    return { id: row.dataset.holiday, date: get('date'), name: get('name').trim(), closed: get('closed') === 'closed', open: get('open'), close: get('close') };
  });
  const drawHolidays = () => {
    holidayList.innerHTML = holidays.length
      ? holidays.map(holidayRow).join('')
      : '<p class="empty">No special hours set. Regular hours are 6 AM to 10 PM every day.</p>';
    holidayList.querySelectorAll('[data-holiday]').forEach((row) => {
      const closed = row.querySelector('[name="closed"]').value === 'closed';
      row.querySelectorAll('[name="open"], [name="close"]').forEach((input) => { input.disabled = closed; });
    });
  };
  drawHolidays();
  holidayList.addEventListener('input', () => ctx.markUnsaved());
  holidayList.addEventListener('change', (event) => {
    if (event.target.name === 'closed') { holidays = readHolidays(); drawHolidays(); }
  });
  holidayList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-holiday]');
    if (!button) return;
    const id = button.closest('[data-holiday]').dataset.holiday;
    holidays = readHolidays().filter((h) => h.id !== id);
    ctx.markUnsaved();
    drawHolidays();
  });
  ctx.view.querySelector('[data-add-holiday]').addEventListener('click', () => {
    holidays = [...readHolidays(), { id: newId(), date: '', name: '', closed: false, open: '08:00', close: '18:00' }];
    ctx.markUnsaved();
    drawHolidays();
    holidayList.lastElementChild.querySelector('input').focus();
  });
  ctx.view.querySelector('[data-holidays]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = readHolidays().sort((a, b) => a.date.localeCompare(b.date));
    if (items.some((h) => !h.date)) return alert('Every holiday needs a date.');
    if (items.some((h) => !h.closed && h.open >= h.close)) return alert('Closing time must be after opening time.');
    if (new Set(items.map((h) => h.date)).size !== items.length) return alert('Two entries share the same date.');
    if (await ctx.saveContent('holiday_hours', { items })) {
      ctx.markUnsaved(false);
      toast('Holiday hours saved');
      ctx.rerender();
    }
  });

  // Today's holiday, if any, for a quick heads-up.
  const todayHoliday = calc.holidayOn(content, today);
  if (todayHoliday) {
    ctx.view.querySelector('[data-holidays]').insertAdjacentHTML('beforebegin', `<p>${pill('warn', 'Today')} ${esc(todayHoliday.name || mediumDate(today))}: ${todayHoliday.closed ? 'closed' : `${esc(todayHoliday.open)}–${esc(todayHoliday.close)}`}</p>`);
  }
}
