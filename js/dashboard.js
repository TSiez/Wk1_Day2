/* ============================================================
   Dashboard — admin console client
   Calls /api/dashboard/* endpoints on the local Express server.
   ============================================================ */

(() => {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ----- API helper -----
  async function api(path, opts = {}) {
    const res = await fetch(`/api/dashboard${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ----- View helpers -----
  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pill = (status) => `<span class="pill pill--${esc(status)}">${esc(status)}</span>`;
  const yesno = (b) => `<span class="pill pill--${b ? 'yes' : 'no'}">${b ? 'yes' : 'no'}</span>`;

  function emptyRow(cols, msg = 'No records yet') {
    return `<tr><td colspan="${cols}" class="dash-empty">${esc(msg)}</td></tr>`;
  }

  function showLogin() {
    $('#loginGate').hidden = false;
    $('#dashApp').hidden = true;
    $('#dash-pw')?.focus();
  }
  function showDash() {
    $('#loginGate').hidden = true;
    $('#dashApp').hidden = false;
  }

  // ----- Login -----
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#loginStatus');
    status.textContent = 'Checking…';
    status.classList.remove('is-error', 'is-success');
    try {
      const res = await fetch('/api/dashboard/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#dash-pw').value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Wrong password.');
      }
      status.textContent = '';
      $('#dash-pw').value = '';
      showDash();
      await loadOverview();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('is-error');
    }
  });

  $('#logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/dashboard/logout', { method: 'POST', credentials: 'same-origin' });
    showLogin();
  });

  // ----- Section switching -----
  $$('.dash__nav-item').forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.section));
  });

  async function activate(name) {
    $$('.dash__nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.section === name));
    $$('.dash-section').forEach(s => s.classList.toggle('is-active', s.dataset.section === name));
    const loader = LOADERS[name];
    if (loader) await loader();
  }

  // ----- Section loaders -----
  const LOADERS = {
    overview:        loadOverview,
    submissions:     loadSubmissions,
    subscribers:     loadSubscribers,
    emails:          loadEmails,
    newsletters:     loadNewsletters,
    'newsletter-new': () => {}, // form is static
  };

  async function loadOverview() {
    try {
      const data = await api('/overview');
      const cards = [
        { label: 'Submissions',  value: data.submissions_total,  sub: `${data.submissions_pending} pending` },
        { label: 'Subscribers',  value: data.subscribers_active, sub: `${data.subscribers_unsubscribed} unsubscribed` },
        { label: 'Emails sent',  value: data.emails_sent,        sub: `${data.emails_failed} failed` },
        { label: 'Newsletters',  value: data.newsletters_total,  sub: `${data.newsletters_drafts} drafts` },
      ];
      $('#statGrid').innerHTML = cards.map(c => `
        <div class="stat-card">
          <div class="stat-card__label">${esc(c.label)}</div>
          <div class="stat-card__value">${esc(c.value)}</div>
          <div class="stat-card__sub">${esc(c.sub)}</div>
        </div>`).join('');

      const recent = data.recent ?? [];
      $('#recentTable tbody').innerHTML = recent.length
        ? recent.map(r => `
          <tr>
            <td class="col-when">${esc(fmt(r.created_at))}</td>
            <td>${esc(r.name)}</td>
            <td>${esc(r.email)}</td>
            <td>${pill(r.reply_status)}</td>
          </tr>`).join('')
        : emptyRow(4);
    } catch (err) { console.error(err); }
  }

  async function loadSubmissions() {
    try {
      const rows = await api('/submissions');
      renderSubsTable(rows);
      $('#subFilter').oninput = () => {
        const q = $('#subFilter').value.toLowerCase();
        renderSubsTable(rows.filter(r =>
          [r.name, r.email, r.message].some(v => String(v).toLowerCase().includes(q))
        ));
      };
    } catch (err) { console.error(err); }
  }

  function renderSubsTable(rows) {
    $('#subsTable tbody').innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td class="col-when">${esc(fmt(r.created_at))}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.email)}</td>
        <td class="col-msg"><div class="col-msg__text" title="${esc(r.message)}">${esc(r.message)}</div></td>
        <td>${pill(r.reply_status)}</td>
        <td>${yesno(r.newsletter_subscribed && !r.unsubscribed_at)}</td>
      </tr>`).join('') : emptyRow(6);
  }

  async function loadSubscribers() {
    try {
      const rows = await api('/subscribers');
      $('#subsListTable tbody').innerHTML = rows.length ? rows.map(r => `
        <tr>
          <td class="col-when">${esc(fmt(r.newsletter_opt_in_at || r.created_at))}</td>
          <td>${esc(r.name)}</td>
          <td>${esc(r.email)}</td>
          <td><button class="row-action row-action--danger" data-unsub="${esc(r.id)}">Unsubscribe</button></td>
        </tr>`).join('') : emptyRow(4, 'No subscribers yet');

      $$('button[data-unsub]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Unsubscribe this person?')) return;
        try {
          await api(`/subscribers/${b.dataset.unsub}/unsubscribe`, { method: 'POST' });
          loadSubscribers();
        } catch (err) { alert(err.message); }
      }));
    } catch (err) { console.error(err); }
  }

  async function loadEmails() {
    try {
      const rows = await api('/emails');
      $('#emailsTable tbody').innerHTML = rows.length ? rows.map(r => `
        <tr>
          <td class="col-when">${esc(fmt(r.sent_at))}</td>
          <td>${esc(r.recipient_email ?? '—')}</td>
          <td>${esc(r.kind)}</td>
          <td>${esc(r.step)}</td>
          <td>${pill(r.status)}</td>
        </tr>`).join('') : emptyRow(5, 'No emails logged yet');
    } catch (err) { console.error(err); }
  }

  async function loadNewsletters() {
    try {
      const rows = await api('/newsletters');
      $('#nlTable tbody').innerHTML = rows.length ? rows.map(r => `
        <tr>
          <td class="col-when">${esc(fmt(r.updated_at))}</td>
          <td>${esc(r.subject)}</td>
          <td>${pill(r.status)}</td>
          <td><button class="row-action row-action--danger" data-del="${esc(r.id)}">Delete</button></td>
        </tr>`).join('') : emptyRow(4, 'No saved newsletters yet');

      $$('button[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this draft?')) return;
        try {
          await api(`/newsletters/${b.dataset.del}`, { method: 'DELETE' });
          loadNewsletters();
        } catch (err) { alert(err.message); }
      }));
    } catch (err) { console.error(err); }
  }

  // ----- New Newsletter form -----
  $('#newsletterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('#nlStatus');
    status.textContent = 'Saving…';
    status.classList.remove('is-error', 'is-success');
    try {
      await api('/newsletters', {
        method: 'POST',
        body: JSON.stringify({
          subject:   $('#nl-subject').value.trim(),
          body_html: $('#nl-body').value,
        }),
      });
      status.textContent = 'Draft saved.';
      status.classList.add('is-success');
      e.target.reset();
      activate('newsletters');
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('is-error');
    }
  });

  // ----- Boot: check if already logged in -----
  (async () => {
    try {
      await api('/me');
      showDash();
      loadOverview();
    } catch {
      showLogin();
    }
  })();
})();
