(function () {
  'use strict';

  const app = document.getElementById('app');
  const config = window.VERVE_INVOICE_CONFIG || {};
  const configuredUrl = String(config.SUPABASE_URL || '').trim();
  const configuredKey = String(config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY || '').trim();
  const hasPlaceholders = !configuredUrl || !configuredKey || configuredUrl.includes('PASTE_') || configuredKey.includes('PASTE_');
  const isConfigured = !hasPlaceholders && /^https:\/\/.+/i.test(configuredUrl);
  let supabaseClient = null;
  let supabaseLibraryError = '';

  async function initializeSupabase() {
    if (!isConfigured) return null;
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.async = true;
        const timeout = setTimeout(() => reject(new Error('The Supabase library timed out while loading.')), 12000);
        script.onload = () => { clearTimeout(timeout); resolve(); };
        script.onerror = () => { clearTimeout(timeout); reject(new Error('The Supabase library could not be loaded.')); };
        document.head.appendChild(script);
      });
    }
    if (!window.supabase?.createClient) throw new Error('The Supabase browser library did not initialize.');
    supabaseClient = window.supabase.createClient(configuredUrl, configuredKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return supabaseClient;
  }

  const state = {
    account: null,
    page: 'dashboard',
    authMode: 'login',
    authError: '',
    modal: null,
    mobileOpen: false,
    invoiceQuery: '',
    invoiceFilter: 'all',
    clientQuery: '',
    draft: null,
    preview: null,
    toastTimer: null,
    booting: true,
  };

  const icons = {
    dashboard: '▦', invoices: '▤', clients: '♟', settings: '⚙', billing: '◆', plus: '+',
    search: '⌕', money: '$', clock: '◷', paid: '✓', file: '▧', users: '♟', edit: '✎',
    trash: '×', eye: '◉', print: '⇩', menu: '☰', logout: '↪', close: '×', mail: '✉'
  };

  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) return prefix + '_' + crypto.randomUUID();
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  }

  function shortDate(value) {
    if (!value) return '—';
    const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  function today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function addDays(dateString, days) {
    const d = new Date((dateString || today()) + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function initials(value) {
    const parts = String(value || 'V').trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map(p => p[0]).join('') || 'V').toUpperCase();
  }

  function defaultProfile(user) {
    const name = String(user?.user_metadata?.full_name || '').trim();
    return {
      businessName: String(user?.user_metadata?.business_name || (name ? name + ' Services' : 'My Business')),
      contactName: name,
      email: user?.email || '',
      phone: '',
      address: '',
      cityStateZip: '',
      website: '',
      taxId: '',
      color: '#4f7cff',
      invoicePrefix: 'INV-',
      nextNumber: 1001,
      paymentTerms: 'Payment is due by the date shown above. Thank you for your business.',
    };
  }

  function profileFromRow(row, user) {
    const fallback = defaultProfile(user);
    return {
      businessName: row?.business_name ?? fallback.businessName,
      contactName: row?.contact_name ?? fallback.contactName,
      email: row?.email ?? fallback.email,
      phone: row?.phone ?? '',
      address: row?.address ?? '',
      cityStateZip: row?.city_state_zip ?? '',
      website: row?.website ?? '',
      taxId: row?.tax_id ?? '',
      color: row?.color ?? '#4f7cff',
      invoicePrefix: row?.invoice_prefix ?? 'INV-',
      nextNumber: Number(row?.next_number || 1001),
      paymentTerms: row?.payment_terms ?? fallback.paymentTerms,
    };
  }

  function profileToRow(profile, userId) {
    return {
      id: userId,
      business_name: profile.businessName || 'My Business',
      contact_name: profile.contactName || '',
      email: profile.email || state.account?.email || '',
      phone: profile.phone || '',
      address: profile.address || '',
      city_state_zip: profile.cityStateZip || '',
      website: profile.website || '',
      tax_id: profile.taxId || '',
      color: profile.color || '#4f7cff',
      invoice_prefix: profile.invoicePrefix || 'INV-',
      next_number: Number(profile.nextNumber || 1001),
      payment_terms: profile.paymentTerms || '',
      updated_at: new Date().toISOString(),
    };
  }

  function clientFromRow(row) {
    return {
      id: row.id,
      name: row.name || '',
      company: row.company || '',
      email: row.email || '',
      phone: row.phone || '',
      address: row.address || '',
      cityStateZip: row.city_state_zip || '',
      notes: row.notes || '',
    };
  }

  function clientToRow(client, userId) {
    const row = {
      user_id: userId,
      name: client.name || '',
      company: client.company || '',
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      city_state_zip: client.cityStateZip || '',
      notes: client.notes || '',
      updated_at: new Date().toISOString(),
    };
    if (client.id) row.id = client.id;
    return row;
  }

  function invoiceFromRow(row) {
    return {
      id: row.id,
      clientId: row.client_id || '',
      invoiceNumber: row.invoice_number || '',
      issueDate: row.issue_date || today(),
      dueDate: row.due_date || addDays(today(), 14),
      status: row.status || 'draft',
      discount: Number(row.discount || 0),
      taxRate: Number(row.tax_rate || 0),
      notes: row.notes || '',
      terms: row.terms || '',
      lines: Array.isArray(row.lines) ? row.lines : [],
    };
  }

  function invoiceToRow(invoice, userId) {
    const totals = invoiceTotals(invoice);
    const row = {
      user_id: userId,
      client_id: invoice.clientId || null,
      invoice_number: invoice.invoiceNumber,
      issue_date: invoice.issueDate,
      due_date: invoice.dueDate,
      status: invoice.status || 'draft',
      discount: Number(invoice.discount || 0),
      tax_rate: Number(invoice.taxRate || 0),
      notes: invoice.notes || '',
      terms: invoice.terms || '',
      lines: invoice.lines || [],
      subtotal: totals.subtotal,
      tax_amount: totals.tax,
      total: totals.total,
      updated_at: new Date().toISOString(),
    };
    if (invoice.id) row.id = invoice.id;
    return row;
  }

  async function ensureProfile(user) {
    let result = await supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;
    const fallback = defaultProfile(user);
    result = await supabaseClient.from('profiles').upsert(profileToRow(fallback, user.id)).select().single();
    if (result.error) throw result.error;
    return result.data;
  }

  async function loadAccount(user) {
    const profileRow = await ensureProfile(user);
    const [clientsResult, invoicesResult] = await Promise.all([
      supabaseClient.from('clients').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabaseClient.from('invoices').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    ]);
    if (clientsResult.error) throw clientsResult.error;
    if (invoicesResult.error) throw invoicesResult.error;
    const profile = profileFromRow(profileRow, user);
    return {
      id: user.id,
      name: profile.contactName || user.user_metadata?.full_name || 'Account owner',
      email: user.email || profile.email,
      plan: profileRow.plan || 'pro',
      profile,
      clients: (clientsResult.data || []).map(clientFromRow),
      invoices: (invoicesResult.data || []).map(invoiceFromRow),
    };
  }

  async function saveClientRemote(client) {
    const payload = clientToRow(client, state.account.id);
    const query = client.id
      ? supabaseClient.from('clients').update(payload).eq('id', client.id)
      : supabaseClient.from('clients').insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return clientFromRow(data);
  }

  async function deleteClientRemote(id) {
    const { error } = await supabaseClient.from('clients').delete().eq('id', id).eq('user_id', state.account.id);
    if (error) throw error;
  }

  async function saveInvoiceRemote(invoice) {
    const payload = invoiceToRow(invoice, state.account.id);
    const query = invoice.id
      ? supabaseClient.from('invoices').update(payload).eq('id', invoice.id)
      : supabaseClient.from('invoices').insert(payload);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return invoiceFromRow(data);
  }

  async function deleteInvoiceRemote(id) {
    const { error } = await supabaseClient.from('invoices').delete().eq('id', id).eq('user_id', state.account.id);
    if (error) throw error;
  }

  async function saveProfileRemote(profile) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .upsert(profileToRow(profile, state.account.id))
      .select()
      .single();
    if (error) throw error;
    return profileFromRow(data, { email: state.account.email, user_metadata: { full_name: profile.contactName } });
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Something went wrong.');
    if (/duplicate key|unique constraint/i.test(message)) return 'That invoice number is already in use.';
    if (/invalid login credentials/i.test(message)) return 'Incorrect email or password.';
    if (/email not confirmed/i.test(message)) return 'Confirm your email address before logging in.';
    if (/failed to fetch|network/i.test(message)) return 'Could not reach the database. Check your internet connection and Supabase settings.';
    return message;
  }

  function invoiceTotals(invoice) {
    const subtotal = (invoice.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.rate || 0), 0);
    const discount = Math.max(0, Number(invoice.discount || 0));
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * Math.max(0, Number(invoice.taxRate || 0)) / 100;
    return { subtotal, discount, tax, total: taxable + tax };
  }

  function invoiceStatus(invoice) {
    if (invoice.status === 'paid') return 'paid';
    if (invoice.status !== 'draft' && invoice.dueDate && invoice.dueDate < today()) return 'overdue';
    return invoice.status || 'draft';
  }

  function getClient(id) {
    return state.account && state.account.clients.find(c => c.id === id);
  }

  function flash(message) {
    let el = document.querySelector('.toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.remove(), 2600);
  }

  function pageTitle() {
    return ({ dashboard: 'Dashboard', invoices: 'Invoices', clients: 'Clients', editor: state.draft && state.draft.id ? 'Edit invoice' : 'New invoice', settings: 'Settings', billing: 'Billing' })[state.page] || 'Verve Invoice';
  }

  function render() {
    if (state.booting) {
      app.innerHTML = '<div class="boot-screen"><div class="boot-logo">V</div><p>Connecting to your secure workspace…</p></div>';
      return;
    }
    if (!isConfigured || !supabaseClient) {
      app.innerHTML = renderSetupScreen();
      return;
    }
    if (!state.account) app.innerHTML = renderMarketing() + renderModal();
    else app.innerHTML = renderShell() + renderModal() + '<div class="demo-badge cloud-badge">Cloud database connected</div>';
  }

  function renderSetupScreen() {
    const libraryMissing = Boolean(isConfigured && !supabaseClient);
    const setupMessage = !isConfigured
      ? 'The website is working, but the Supabase project URL and publishable key have not been added yet.'
      : (supabaseLibraryError || 'The Supabase library could not load. Check the internet connection or content-security settings.');
    return `<main class="setup-page"><section class="setup-card"><div class="brand-mark setup-logo">V</div><span class="eyebrow">Database setup required</span><h1>Connect Verve Invoice to Supabase</h1><p>${esc(setupMessage)}</p><ol><li>Create a Supabase project.</li><li>Run <code>supabase/schema.sql</code> in the Supabase SQL Editor.</li><li>Paste the project URL and publishable key into <code>config.js</code>.</li><li>Upload the files to your website and refresh.</li></ol><div class="setup-note"><strong>Security:</strong> Use only the publishable or anon key in <code>config.js</code>. Never use the <code>service_role</code> key in a website.</div><p class="help">Complete instructions are included in SETUP.md.</p></section></main>`;
  }

  function renderMarketing() {
    return `
      <main class="marketing">
        <nav class="marketing-nav">
          <a href="#" class="brand" data-action="home">
            <span class="brand-mark">V</span>
            <span>Verve Invoice <span class="brand-sub">by Verve AI Solutions</span></span>
          </a>
          <div class="nav-links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#about">How it works</a></div>
          <div class="nav-actions">
            <button class="btn btn-outline" data-action="open-auth" data-mode="login">Log in</button>
            <button class="btn btn-primary" data-action="open-auth" data-mode="signup">Start free</button>
          </div>
        </nav>

        <section class="hero">
          <div class="hero-copy-area">
            <span class="eyebrow">Built for service businesses</span>
            <h1>Invoices that look <span>as professional</span> as your work.</h1>
            <p class="hero-copy">Create polished invoices, manage customers, track payments, and save invoices as PDFs from one simple dashboard.</p>
            <div class="hero-actions">
              <button class="btn btn-primary" data-action="open-auth" data-mode="signup">Create your account →</button>
              <button class="btn btn-outline" data-action="open-auth" data-mode="login">Log in securely</button>
            </div>
            <div class="trust-row"><span>No credit card</span><span>Works on phones</span><span>PDF invoices</span></div>
          </div>
          <div class="hero-window" aria-hidden="true">
            <div class="window-bar"><i class="window-dot"></i><i class="window-dot"></i><i class="window-dot"></i></div>
            <div class="hero-app">
              <div class="mini-sidebar"><div class="mini-logo"></div><div class="mini-line active"></div><div class="mini-line"></div><div class="mini-line"></div><div class="mini-line"></div></div>
              <div class="hero-app-main">
                <div class="hero-app-head"><div class="fake-title"></div><div class="fake-button"></div></div>
                <div class="fake-stats"><div class="fake-card"><i></i><strong>$8,450</strong></div><div class="fake-card"><i></i><strong>$1,740</strong></div><div class="fake-card"><i></i><strong>12</strong></div></div>
                <div class="fake-table"><div class="fake-row"><span></span><span></span><span></span></div><div class="fake-row"><span></span><span></span><span></span></div><div class="fake-row"><span></span><span></span><span></span></div><div class="fake-row"><span></span><span></span><span></span></div></div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" class="marketing-section">
          <div class="section-head"><span class="kicker">Everything you need</span><h2>Spend less time invoicing</h2><p>A clean set of tools for contractors, consultants, agencies, and local service companies.</p></div>
          <div class="feature-grid">
            ${feature('▧', 'Professional invoices', 'Build itemized invoices with custom payment terms, tax, discounts, notes, and your business information.')}
            ${feature('♟', 'Customer records', 'Save customer contact and billing information so repeat invoices take only a few clicks.')}
            ${feature('⇩', 'PDF downloads', 'Open a print-ready invoice and choose Save as PDF from any modern desktop or mobile browser.')}
            ${feature('◷', 'Payment tracking', 'Mark invoices as draft, sent, or paid and automatically identify overdue balances.')}
            ${feature('◉', 'Fast dashboard', 'See outstanding revenue, paid totals, overdue balances, and recent activity immediately.')}
            ${feature('◈', 'Your branding', 'Set your company information, invoice numbering, payment terms, and brand color.')}
          </div>
        </section>

        <section id="pricing" class="marketing-section" style="padding-top:15px">
          <div class="section-head"><span class="kicker">Simple pricing</span><h2>A plan for every business</h2><p>These prices are editable in the source before you launch it for your customers.</p></div>
          <div class="pricing-grid">
            ${priceCard('Starter', 9, ['25 invoices each month', 'Unlimited clients', 'PDF downloads', 'Email support'], false)}
            ${priceCard('Pro', 19, ['Unlimited invoices', 'Custom branding', 'Payment tracking', 'Priority support'], true)}
            ${priceCard('Agency', 49, ['Everything in Pro', 'Multiple business profiles', 'Team access', 'White-label options'], false)}
          </div>
        </section>

        <section id="about" class="marketing-section">
          <div class="cta-band"><div><h2>Ready to send a better invoice?</h2><p>Create an account and build your first professional invoice.</p></div><button class="btn btn-light" data-action="open-auth" data-mode="signup">Get started →</button></div>
        </section>
        <footer class="marketing-footer">© ${new Date().getFullYear()} Verve AI Solutions · Invoice software for growing businesses</footer>
      </main>`;
  }

  function feature(icon, title, text) {
    return `<article class="feature-card"><div class="feature-icon">${icon}</div><h3>${title}</h3><p>${text}</p></article>`;
  }

  function priceCard(name, price, features, featured) {
    return `<article class="price-card ${featured ? 'featured' : ''}">${featured ? '<span class="popular">MOST POPULAR</span>' : ''}<h3>${name}</h3><div class="price">$${price}<small>/month</small></div><p class="help">For ${name === 'Starter' ? 'new businesses' : name === 'Pro' ? 'growing companies' : 'teams and resellers'}.</p><ul>${features.map(f => `<li>${f}</li>`).join('')}</ul><button class="btn ${featured ? 'btn-primary' : ''}" style="width:100%" data-action="open-auth" data-mode="signup">Start free</button></article>`;
  }

  function renderModal() {
    if (!state.modal) return '';
    if (state.modal === 'auth') return renderAuthModal();
    if (state.modal === 'client') return renderClientModal();
    if (state.modal === 'preview') return renderPreviewModal();
    return '';
  }

  function renderAuthModal(error) {
    const signup = state.authMode === 'signup';
    return `<div class="modal-backdrop" data-action="close-modal-self">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><div style="text-align:center;width:100%"><div class="brand-mark auth-logo">V</div><h2>${signup ? 'Create your account' : 'Welcome back'}</h2><p>${signup ? 'Start creating professional invoices.' : 'Log in to your invoice dashboard.'}</p></div><button class="close-btn" data-action="close-modal">×</button></div>
        <div class="modal-body">
          <div class="auth-tabs"><button class="auth-tab ${!signup ? 'active' : ''}" data-action="auth-tab" data-mode="login">Log in</button><button class="auth-tab ${signup ? 'active' : ''}" data-action="auth-tab" data-mode="signup">Sign up</button></div>
          ${(error || state.authError) ? `<div class="auth-error">${esc(error || state.authError)}</div>` : ''}
          <form id="auth-form" class="form-grid">
            ${signup ? `<div class="field full"><label>Your name</label><input class="input" name="name" required autocomplete="name" placeholder="Kevin Pelletier"></div>` : ''}
            <div class="field full"><label>Email address</label><input class="input" name="email" type="email" required autocomplete="email" placeholder="you@business.com"></div>
            <div class="field full"><label>Password</label><input class="input" name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="At least 8 characters"></div>
            <button class="btn btn-primary full" type="submit">${signup ? 'Create account →' : 'Log in →'}</button>
          </form>
          <p class="help" style="text-align:center;margin:16px 0 0">Secure cloud account powered by Supabase Auth. Invoice and client data are stored in the database and protected per user.</p>
        </div>
      </div>
    </div>`;
  }

  function renderShell() {
    const p = state.account.profile;
    return `<div class="app-layout">
      <aside class="sidebar ${state.mobileOpen ? 'open' : ''}">
        <div class="brand"><span class="brand-mark">${esc(initials(p.businessName).slice(0,1))}</span><span>Verve Invoice<span class="brand-sub" style="display:block">${esc(p.businessName)}</span></span></div>
        <nav class="sidebar-nav">
          ${navButton('dashboard', icons.dashboard, 'Dashboard')}
          ${navButton('invoices', icons.invoices, 'Invoices')}
          ${navButton('clients', icons.clients, 'Clients')}
          ${navButton('settings', icons.settings, 'Settings')}
          ${navButton('billing', icons.billing, 'Billing')}
        </nav>
        <div class="sidebar-bottom">
          <button class="nav-item" data-action="logout"><span class="nav-icon">${icons.logout}</span>Log out</button>
          <div class="user-card"><div class="avatar">${esc(initials(state.account.name))}</div><div class="user-copy"><strong>${esc(state.account.name || 'Account owner')}</strong><small>${esc(state.account.email)}</small></div></div>
        </div>
      </aside>
      <main class="main-wrap">
        <header class="topbar"><div class="topbar-left"><button class="btn btn-icon mobile-menu" data-action="mobile-menu">${icons.menu}</button><h1>${esc(pageTitle())}</h1></div>${state.page !== 'editor' ? '<button class="btn btn-primary" data-action="new-invoice">+ New invoice</button>' : ''}</header>
        <div class="content">${renderPage()}</div>
      </main>
    </div>`;
  }

  function navButton(page, icon, label) {
    const active = state.page === page || (page === 'invoices' && state.page === 'editor');
    return `<button class="nav-item ${active ? 'active' : ''}" data-action="nav" data-page="${page}"><span class="nav-icon">${icon}</span>${label}</button>`;
  }

  function renderPage() {
    if (state.page === 'dashboard') return renderDashboard();
    if (state.page === 'invoices') return renderInvoices();
    if (state.page === 'clients') return renderClients();
    if (state.page === 'editor') return renderEditor();
    if (state.page === 'settings') return renderSettings();
    if (state.page === 'billing') return renderBilling();
    return renderDashboard();
  }

  function renderDashboard() {
    const invoices = state.account.invoices;
    let paid = 0, outstanding = 0, overdue = 0;
    invoices.forEach(inv => {
      const total = invoiceTotals(inv).total;
      const status = invoiceStatus(inv);
      if (status === 'paid') paid += total;
      else if (status !== 'draft') outstanding += total;
      if (status === 'overdue') overdue += total;
    });
    const recent = invoices.slice().sort((a,b) => (b.issueDate || '').localeCompare(a.issueDate || '')).slice(0,5);
    return `<div class="page-head"><div><h2>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${esc((state.account.name || 'there').split(' ')[0])}</h2><p>Here is how your business is doing.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="new-invoice">+ Create invoice</button></div></div>
      <section class="stats-grid">
        ${stat('Total paid', money(paid), icons.paid, `${invoices.filter(i => invoiceStatus(i) === 'paid').length} paid invoices`)}
        ${stat('Outstanding', money(outstanding), icons.money, 'Sent and overdue')}
        ${stat('Overdue', money(overdue), icons.clock, overdue ? 'Needs attention' : 'Nothing overdue')}
        ${stat('Clients', state.account.clients.length, icons.users, 'Saved customers')}
      </section>
      <section class="dashboard-grid">
        <div class="card"><div class="card-head"><h3>Recent invoices</h3><button class="btn btn-sm" data-action="nav" data-page="invoices">View all →</button></div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Status</th><th>Total</th></tr></thead><tbody>${recent.map(invoiceRowCompact).join('')}</tbody></table></div>` : emptyState('▧','No invoices yet','Create your first invoice to see it here','new-invoice','Create invoice')}</div>
        <div class="card"><div class="card-head"><h3>Quick actions</h3></div><div class="card-body"><div class="quick-list">
          ${quickAction('Create an invoice','Bill a customer for your work','new-invoice','+')}
          ${quickAction('Add a client','Save customer billing details','new-client','♟')}
          ${quickAction('Customize branding','Add your business information','nav','⚙','settings')}
        </div></div></div>
      </section>`;
  }

  function stat(label, value, icon, note) {
    return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><strong>${value}</strong><span class="stat-note">${note}</span></article>`;
  }

  function quickAction(title, sub, action, icon, page) {
    return `<button class="quick-item" data-action="${action}" ${page ? `data-page="${page}"` : ''} style="width:100%;background:#fff;text-align:left"><div class="quick-copy"><strong>${title}</strong><small>${sub}</small></div><span class="stat-icon">${icon}</span></button>`;
  }

  function invoiceRowCompact(inv) {
    const client = getClient(inv.clientId);
    const status = invoiceStatus(inv);
    return `<tr><td><button class="table-link" data-action="preview-invoice" data-id="${inv.id}">${esc(inv.invoiceNumber)}</button><div class="help">${shortDate(inv.issueDate)}</div></td><td>${esc(client ? (client.company || client.name) : 'Deleted client')}</td><td><span class="badge ${status}">${status}</span></td><td><strong>${money(invoiceTotals(inv).total)}</strong></td></tr>`;
  }

  function renderInvoices() {
    const query = state.invoiceQuery.toLowerCase();
    const rows = state.account.invoices.filter(inv => {
      const client = getClient(inv.clientId);
      const hay = `${inv.invoiceNumber} ${client ? client.name + ' ' + client.company : ''}`.toLowerCase();
      const status = invoiceStatus(inv);
      return hay.includes(query) && (state.invoiceFilter === 'all' || status === state.invoiceFilter);
    }).sort((a,b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
    return `<div class="page-head"><div><h2>Invoices</h2><p>Create, send, and track customer invoices.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="new-invoice">+ New invoice</button></div></div>
      <div class="toolbar"><div class="toolbar-left"><div class="search-box"><span>${icons.search}</span><input id="invoice-search" class="input" placeholder="Search invoices or clients" value="${esc(state.invoiceQuery)}"></div><select id="invoice-filter" class="select" style="width:160px"><option value="all" ${state.invoiceFilter==='all'?'selected':''}>All statuses</option><option value="draft" ${state.invoiceFilter==='draft'?'selected':''}>Draft</option><option value="sent" ${state.invoiceFilter==='sent'?'selected':''}>Sent</option><option value="paid" ${state.invoiceFilter==='paid'?'selected':''}>Paid</option><option value="overdue" ${state.invoiceFilter==='overdue'?'selected':''}>Overdue</option></select></div></div>
      <div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th>Total</th><th>Actions</th></tr></thead><tbody>${rows.map(inv => {
        const c=getClient(inv.clientId), s=invoiceStatus(inv); return `<tr><td><button class="table-link" data-action="preview-invoice" data-id="${inv.id}">${esc(inv.invoiceNumber)}</button></td><td>${esc(c ? c.company || c.name : 'Deleted client')}</td><td>${shortDate(inv.issueDate)}</td><td>${shortDate(inv.dueDate)}</td><td><span class="badge ${s}">${s}</span></td><td><strong>${money(invoiceTotals(inv).total)}</strong></td><td><div class="action-row"><button class="action-btn" title="Preview" data-action="preview-invoice" data-id="${inv.id}">${icons.eye}</button><button class="action-btn" title="Edit" data-action="edit-invoice" data-id="${inv.id}">${icons.edit}</button><button class="action-btn danger" title="Delete" data-action="delete-invoice" data-id="${inv.id}">${icons.trash}</button></div></td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('⌕','No matching invoices','Try a different search or create a new invoice','new-invoice','Create invoice')}</div>`;
  }

  function renderClients() {
    const q = state.clientQuery.toLowerCase();
    const clients = state.account.clients.filter(c => `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(q));
    return `<div class="page-head"><div><h2>Clients</h2><p>Keep customer contact and billing information organized.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="new-client">+ Add client</button></div></div>
      <div class="toolbar"><div class="search-box"><span>${icons.search}</span><input id="client-search" class="input" placeholder="Search clients" value="${esc(state.clientQuery)}"></div></div>
      ${clients.length ? `<div class="client-grid">${clients.map(client => {
        const invoices=state.account.invoices.filter(i=>i.clientId===client.id); const billed=invoices.reduce((sum,i)=>sum+invoiceTotals(i).total,0);
        return `<article class="client-card"><div class="client-card-head"><div class="client-avatar">${esc(initials(client.company || client.name))}</div><div class="action-row"><button class="action-btn" data-action="edit-client" data-id="${client.id}">${icons.edit}</button><button class="action-btn danger" data-action="delete-client" data-id="${client.id}">${icons.trash}</button></div></div><h3>${esc(client.company || client.name)}</h3><p>${client.company ? esc(client.name) : 'Individual customer'}</p><div class="client-meta"><span>${icons.mail} ${esc(client.email || 'No email')}</span><span>☎ ${esc(client.phone || 'No phone')}</span><span>⌖ ${esc([client.address,client.cityStateZip].filter(Boolean).join(', ') || 'No address')}</span></div><div class="client-total"><span>${invoices.length} invoice${invoices.length===1?'':'s'}</span><strong>${money(billed)} billed</strong></div></article>`;
      }).join('')}</div>` : emptyState('♟','No clients found','Add customer information before creating an invoice','new-client','Add client')}`;
  }

  function newDraft() {
    const p = state.account.profile;
    return { id: null, clientId: state.account.clients[0] ? state.account.clients[0].id : '', invoiceNumber: p.invoicePrefix + p.nextNumber, issueDate: today(), dueDate: addDays(today(), 14), status: 'draft', discount: 0, taxRate: 0, notes: '', terms: p.paymentTerms || '', lines: [{ id: uid('line'), description: '', quantity: 1, rate: 0 }] };
  }

  function renderEditor() {
    if (!state.draft) state.draft = newDraft();
    const d = state.draft;
    const totals = invoiceTotals(d);
    if (!state.account.clients.length) return emptyState('♟','Add a client first','Invoices need a customer with billing details','new-client','Add client');
    return `<div class="page-head"><div><h2>${d.id ? 'Edit invoice' : 'Create invoice'}</h2><p>Complete the details below, then preview or save.</p></div></div>
      <form id="invoice-form">
        <div class="editor-layout">
          <div>
            <section class="editor-card"><h3>Invoice details</h3><div class="form-grid">
              <div class="field full"><label>Bill to</label><select class="select" data-invoice-field="clientId" required>${state.account.clients.map(c=>`<option value="${c.id}" ${d.clientId===c.id?'selected':''}>${esc(c.company || c.name)}${c.company ? ' · '+esc(c.name) : ''}</option>`).join('')}</select></div>
              <div class="field"><label>Invoice number</label><input class="input" data-invoice-field="invoiceNumber" value="${esc(d.invoiceNumber)}" required></div>
              <div class="field"><label>Status</label><select class="select" data-invoice-field="status"><option value="draft" ${d.status==='draft'?'selected':''}>Draft</option><option value="sent" ${d.status==='sent'?'selected':''}>Sent</option><option value="paid" ${d.status==='paid'?'selected':''}>Paid</option></select></div>
              <div class="field"><label>Issue date</label><input class="input" type="date" data-invoice-field="issueDate" value="${esc(d.issueDate)}" required></div>
              <div class="field"><label>Due date</label><input class="input" type="date" data-invoice-field="dueDate" value="${esc(d.dueDate)}" required></div>
            </div></section>
            <section class="editor-card" style="margin-top:18px"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Line items</h3><button type="button" class="btn btn-sm" data-action="add-line">+ Add item</button></div>
              <div class="line-items"><div class="line-head"><span>Description</span><span>Qty</span><span>Rate</span><span style="text-align:right">Amount</span><span></span></div>
                <div id="line-list">${d.lines.map(lineRow).join('')}</div>
              </div>
            </section>
            <section class="editor-card" style="margin-top:18px"><h3>Notes and terms</h3><div class="form-grid"><div class="field full"><label>Customer note</label><textarea class="textarea" data-invoice-field="notes" placeholder="Thank your customer or describe the project">${esc(d.notes)}</textarea></div><div class="field full"><label>Payment terms</label><textarea class="textarea" data-invoice-field="terms">${esc(d.terms)}</textarea></div></div></section>
          </div>
          <aside class="editor-card summary-box"><h3>Invoice summary</h3><div class="form-grid" style="grid-template-columns:1fr 1fr"><div class="field"><label>Discount ($)</label><input class="input" type="number" min="0" step="0.01" data-invoice-field="discount" value="${Number(d.discount||0)}"></div><div class="field"><label>Tax (%)</label><input class="input" type="number" min="0" step="0.01" data-invoice-field="taxRate" value="${Number(d.taxRate||0)}"></div></div><div style="margin-top:18px"><div class="summary-row"><span>Subtotal</span><strong id="sum-subtotal">${money(totals.subtotal)}</strong></div><div class="summary-row"><span>Discount</span><strong id="sum-discount">-${money(totals.discount)}</strong></div><div class="summary-row"><span>Tax</span><strong id="sum-tax">${money(totals.tax)}</strong></div><div class="summary-row total"><span>Total</span><strong id="sum-total">${money(totals.total)}</strong></div></div><button type="button" class="btn" style="width:100%;margin-top:18px" data-action="preview-draft">${icons.eye} Preview invoice</button></aside>
        </div>
        <div class="editor-footer"><button type="button" class="btn" data-action="cancel-editor">Cancel</button><button type="submit" class="btn btn-primary">${icons.paid} Save invoice</button></div>
      </form>`;
  }

  function lineRow(line) {
    const amount = Number(line.quantity || 0) * Number(line.rate || 0);
    return `<div class="line-row" data-line-id="${line.id}"><input class="input description line-input" data-line-field="description" placeholder="Service or item" value="${esc(line.description)}"><input class="input line-input" data-line-field="quantity" type="number" min="0" step="0.01" value="${Number(line.quantity||0)}"><input class="input rate line-input" data-line-field="rate" type="number" min="0" step="0.01" value="${Number(line.rate||0)}"><div class="line-total">${money(amount)}</div><button type="button" class="action-btn danger" data-action="remove-line" data-id="${line.id}">${icons.trash}</button></div>`;
  }

  function renderClientModal() {
    const id = state.modalClientId;
    const c = id ? state.account.clients.find(x => x.id === id) : { id:'',name:'',company:'',email:'',phone:'',address:'',cityStateZip:'',notes:'' };
    return `<div class="modal-backdrop" data-action="close-modal-self"><div class="modal"><div class="modal-head"><div><h2>${id ? 'Edit client' : 'Add client'}</h2><p>Save customer billing and contact details.</p></div><button class="close-btn" data-action="close-modal">×</button></div><form id="client-form"><div class="modal-body"><input type="hidden" name="id" value="${esc(c.id)}"><div class="form-grid"><div class="field"><label>Contact name</label><input class="input" name="name" required value="${esc(c.name)}"></div><div class="field"><label>Company</label><input class="input" name="company" value="${esc(c.company)}"></div><div class="field"><label>Email</label><input class="input" name="email" type="email" value="${esc(c.email)}"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(c.phone)}"></div><div class="field full"><label>Street address</label><input class="input" name="address" value="${esc(c.address)}"></div><div class="field full"><label>City, state, ZIP</label><input class="input" name="cityStateZip" value="${esc(c.cityStateZip)}"></div><div class="field full"><label>Private notes</label><textarea class="textarea" name="notes">${esc(c.notes)}</textarea></div></div></div><div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save client</button></div></form></div></div>`;
  }

  function renderPreviewModal() {
    const invoice = state.preview;
    if (!invoice) return '';
    const client = getClient(invoice.clientId) || {};
    const status = invoiceStatus(invoice);
    return `<div class="modal-backdrop"><div class="modal large"><div class="modal-body" style="padding-top:10px"><div class="preview-actions no-print"><div><button class="btn" data-action="close-modal">← Back</button></div><div class="page-actions">${invoice.id ? `<button class="btn" data-action="mark-status" data-id="${invoice.id}" data-status="sent">Mark sent</button><button class="btn" data-action="mark-status" data-id="${invoice.id}" data-status="paid">Mark paid</button>` : ''}<button class="btn btn-primary" data-action="print-invoice">${icons.print} Print / Save PDF</button></div></div>${invoiceSheet(invoice,client,status)}</div></div></div>`;
  }

  function invoiceSheet(invoice, client, status) {
    const p = state.account.profile, t = invoiceTotals(invoice);
    return `<article class="invoice-sheet" style="--invoice-color:${esc(p.color)}"><div class="invoice-top"><div class="invoice-brand"><div class="invoice-brand-logo">${esc(initials(p.businessName).slice(0,2))}</div><div><strong style="font-size:20px">${esc(p.businessName)}</strong><div class="help">${esc(p.email || state.account.email)}</div></div></div><div class="invoice-label">INVOICE</div></div>
      <div class="invoice-meta"><div><small>Invoice number</small><strong>${esc(invoice.invoiceNumber)}</strong></div><div><small>Issue date</small><strong>${shortDate(invoice.issueDate)}</strong></div><div><small>Due date</small><strong>${shortDate(invoice.dueDate)}</strong></div></div>
      <div class="invoice-parties"><div class="bill-block"><small>From</small><strong>${esc(p.businessName)}</strong><br>${esc(p.contactName)}${p.address?'<br>'+esc(p.address):''}${p.cityStateZip?'<br>'+esc(p.cityStateZip):''}${p.phone?'<br>'+esc(p.phone):''}${p.email?'<br>'+esc(p.email):''}</div><div class="bill-block"><small>Bill to</small><strong>${esc(client.company || client.name || 'Customer')}</strong>${client.company&&client.name?'<br>'+esc(client.name):''}${client.address?'<br>'+esc(client.address):''}${client.cityStateZip?'<br>'+esc(client.cityStateZip):''}${client.email?'<br>'+esc(client.email):''}</div></div>
      <div class="table-wrap"><table class="invoice-table"><thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>${(invoice.lines||[]).map(l=>`<tr><td>${esc(l.description || 'Service')}</td><td>${Number(l.quantity||0)}</td><td>${money(l.rate)}</td><td style="text-align:right"><strong>${money(Number(l.quantity||0)*Number(l.rate||0))}</strong></td></tr>`).join('')}</tbody></table></div>
      <div class="invoice-totals"><div class="summary-row"><span>Subtotal</span><strong>${money(t.subtotal)}</strong></div>${t.discount?`<div class="summary-row"><span>Discount</span><strong>-${money(t.discount)}</strong></div>`:''}${t.tax?`<div class="summary-row"><span>Tax (${Number(invoice.taxRate||0)}%)</span><strong>${money(t.tax)}</strong></div>`:''}<div class="summary-row total"><span>Total due</span><strong>${money(t.total)}</strong></div><div style="text-align:right;margin-top:9px"><span class="badge ${status}">${status}</span></div></div>
      ${(invoice.notes||invoice.terms)?`<div class="invoice-note">${invoice.notes?`<strong>Note</strong><br>${esc(invoice.notes).replace(/\n/g,'<br>')}<br><br>`:''}${invoice.terms?`<strong>Payment terms</strong><br>${esc(invoice.terms).replace(/\n/g,'<br>')}`:''}</div>`:''}</article>`;
  }

  function renderSettings() {
    const p = state.account.profile;
    return `<div class="page-head"><div><h2>Business settings</h2><p>Control the information and branding shown on invoices.</p></div></div><div class="settings-layout"><div class="settings-nav"><button class="active">Business profile</button><button>Invoice defaults</button><button>Data and security</button></div><form id="settings-form" class="settings-form"><h3 style="margin-top:0">Business profile</h3><div class="form-grid"><div class="field"><label>Business name</label><input class="input" name="businessName" required value="${esc(p.businessName)}"></div><div class="field"><label>Contact name</label><input class="input" name="contactName" value="${esc(p.contactName)}"></div><div class="field"><label>Email</label><input class="input" name="email" type="email" value="${esc(p.email)}"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(p.phone)}"></div><div class="field full"><label>Street address</label><input class="input" name="address" value="${esc(p.address)}"></div><div class="field full"><label>City, state, ZIP</label><input class="input" name="cityStateZip" value="${esc(p.cityStateZip)}"></div><div class="field"><label>Website</label><input class="input" name="website" value="${esc(p.website)}"></div><div class="field"><label>Tax ID (optional)</label><input class="input" name="taxId" value="${esc(p.taxId)}"></div><div class="field"><label>Invoice prefix</label><input class="input" name="invoicePrefix" value="${esc(p.invoicePrefix)}"></div><div class="field"><label>Next invoice number</label><input class="input" name="nextNumber" type="number" min="1" value="${Number(p.nextNumber||1001)}"></div><div class="field full"><label>Default payment terms</label><textarea class="textarea" name="paymentTerms">${esc(p.paymentTerms)}</textarea></div><div class="field full"><label>Brand color</label><div class="color-row">${['#4f7cff','#146c94','#13966f','#7c55d9','#cf5d35','#1d2838'].map(c=>`<button type="button" class="color-choice ${p.color===c?'active':''}" style="background:${c}" data-action="set-color" data-color="${c}" aria-label="${c}"></button>`).join('')}<input type="hidden" name="color" id="profile-color" value="${esc(p.color)}"></div></div></div><div style="display:flex;justify-content:flex-end;margin-top:22px"><button class="btn btn-primary" type="submit">Save settings</button></div></form></div>`;
  }

  function renderBilling() {
    return `<div class="page-head"><div><h2>Billing</h2><p>Connect this page to Stripe before launching subscriptions.</p></div></div><div class="card" style="max-width:760px"><div class="card-head"><h3>Current plan</h3><span class="badge paid">Active</span></div><div class="card-body"><div style="display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap"><div><h2 style="margin:0 0 6px">Pro plan</h2><p style="margin:0;color:var(--muted)">Unlimited invoices, customer records, PDF exports, and custom branding.</p></div><div style="font-size:34px;font-weight:900">$19<small style="font-size:14px;color:var(--muted)">/month</small></div></div><div style="background:#fff7df;border:1px solid #f0d38f;color:#7d5700;padding:14px;border-radius:11px;margin-top:22px"><strong>Stripe is not connected yet.</strong><br><span class="help" style="color:#7d5700">The interface is ready, but real recurring billing needs a secure server or Stripe Checkout integration.</span></div><button class="btn btn-primary" style="margin-top:18px" data-action="billing-info">Connect Stripe Checkout</button></div></div>`;
  }

  function emptyState(icon,title,text,action,label) {
    return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p>${action?`<button class="btn btn-primary" data-action="${action}">${label}</button>`:''}</div>`;
  }

  function syncEditorFromDOM() {
    if (!state.draft) return;
    document.querySelectorAll('[data-invoice-field]').forEach(el => {
      const key = el.dataset.invoiceField;
      state.draft[key] = (key === 'discount' || key === 'taxRate') ? Number(el.value || 0) : el.value;
    });
    const rows = Array.from(document.querySelectorAll('[data-line-id]'));
    state.draft.lines = rows.map(row => {
      const existing = state.draft.lines.find(l => l.id === row.dataset.lineId) || { id: row.dataset.lineId };
      row.querySelectorAll('[data-line-field]').forEach(el => {
        const key = el.dataset.lineField;
        existing[key] = (key === 'quantity' || key === 'rate') ? Number(el.value || 0) : el.value;
      });
      return existing;
    });
  }

  function updateEditorTotals() {
    syncEditorFromDOM();
    const t = invoiceTotals(state.draft);
    const map = { 'sum-subtotal': money(t.subtotal), 'sum-discount': '-' + money(t.discount), 'sum-tax': money(t.tax), 'sum-total': money(t.total) };
    Object.keys(map).forEach(id => { const el=document.getElementById(id); if(el) el.textContent=map[id]; });
    document.querySelectorAll('[data-line-id]').forEach(row => {
      const q=Number(row.querySelector('[data-line-field="quantity"]').value||0), r=Number(row.querySelector('[data-line-field="rate"]').value||0);
      const el=row.querySelector('.line-total'); if(el) el.textContent=money(q*r);
    });
  }

  async function saveInvoiceDraft() {
    syncEditorFromDOM();
    const d = state.draft;
    if (!d.clientId) return flash('Choose a client');
    if (!d.invoiceNumber.trim()) return flash('Enter an invoice number');
    if (!d.lines.length || d.lines.every(l => !String(l.description || '').trim())) return flash('Add at least one line item');
    const duplicate = state.account.invoices.find(i => i.invoiceNumber.toLowerCase() === d.invoiceNumber.toLowerCase() && i.id !== d.id);
    if (duplicate) return flash('That invoice number is already in use');

    const wasNew = !d.id;
    try {
      const saved = await saveInvoiceRemote(d);
      if (wasNew) {
        state.account.invoices.unshift(saved);
        const numberAtEnd = parseInt((d.invoiceNumber.match(/(\d+)$/) || [])[1] || 0, 10);
        state.account.profile.nextNumber = Math.max(Number(state.account.profile.nextNumber || 1001) + 1, numberAtEnd + 1);
        try {
          const updatedProfile = await saveProfileRemote(state.account.profile);
          state.account.profile = updatedProfile;
        } catch (profileError) {
          console.warn('Invoice saved, but the next invoice number could not be updated.', profileError);
        }
      } else {
        const index = state.account.invoices.findIndex(i => i.id === saved.id);
        if (index >= 0) state.account.invoices[index] = saved;
      }
      state.draft = null;
      state.page = 'invoices';
      render();
      flash('Invoice saved to the cloud');
    } catch (error) {
      flash(friendlyError(error));
    }
  }

  function printInvoice(invoice) {
    const client = getClient(invoice.clientId) || {};
    const p = state.account.profile;
    const t = invoiceTotals(invoice);
    const win = window.open('', '_blank', 'width=980,height=850');
    if (!win) return flash('Allow pop-ups to print the invoice');
    const rows = (invoice.lines || []).map(l => `<tr><td>${esc(l.description||'Service')}</td><td>${Number(l.quantity||0)}</td><td>${money(l.rate)}</td><td style="text-align:right"><b>${money(Number(l.quantity||0)*Number(l.rate||0))}</b></td></tr>`).join('');
    win.document.write(`<!doctype html><html><head><title>${esc(invoice.invoiceNumber)}</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1d2738;margin:0;background:#fff}.sheet{max-width:850px;margin:auto;padding:44px}.top{display:flex;justify-content:space-between;gap:30px}.brand{display:flex;align-items:center;gap:13px}.logo{width:52px;height:52px;border-radius:13px;display:grid;place-items:center;background:${esc(p.color)};color:#fff;font-weight:900}.label{font-size:40px;letter-spacing:.1em;color:#99a4b4}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:35px 0;padding:18px;background:#f5f7fa;border-radius:10px}.meta small,.party small{color:#8994a5;text-transform:uppercase;font-size:10px;letter-spacing:.08em;display:block;margin-bottom:5px}.parties{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:28px 0;line-height:1.55;color:#4f5b6d}.party strong{color:#1d2738}table{width:100%;border-collapse:collapse}th{background:${esc(p.color)};color:white;text-align:left;padding:12px;font-size:12px}td{padding:13px 12px;border-bottom:1px solid #e6eaf0}.totals{width:330px;margin:25px 0 0 auto}.row{display:flex;justify-content:space-between;padding:8px 0;color:#657185}.row.total{border-top:1px solid #dfe4eb;margin-top:8px;padding-top:15px;color:#182235;font-size:18px;font-weight:900}.note{border-top:1px solid #e1e6ec;margin-top:36px;padding-top:18px;line-height:1.55;color:#586476}@page{margin:.35in}@media print{.sheet{padding:12px}}
    </style></head><body><div class="sheet"><div class="top"><div class="brand"><div class="logo">${esc(initials(p.businessName).slice(0,2))}</div><div><b style="font-size:20px">${esc(p.businessName)}</b><div style="color:#7a8595;font-size:12px">${esc(p.email||state.account.email)}</div></div></div><div class="label">INVOICE</div></div><div class="meta"><div><small>Invoice number</small><b>${esc(invoice.invoiceNumber)}</b></div><div><small>Issue date</small><b>${shortDate(invoice.issueDate)}</b></div><div><small>Due date</small><b>${shortDate(invoice.dueDate)}</b></div></div><div class="parties"><div class="party"><small>From</small><strong>${esc(p.businessName)}</strong><br>${esc(p.contactName)}${p.address?'<br>'+esc(p.address):''}${p.cityStateZip?'<br>'+esc(p.cityStateZip):''}${p.phone?'<br>'+esc(p.phone):''}${p.email?'<br>'+esc(p.email):''}</div><div class="party"><small>Bill to</small><strong>${esc(client.company||client.name||'Customer')}</strong>${client.company&&client.name?'<br>'+esc(client.name):''}${client.address?'<br>'+esc(client.address):''}${client.cityStateZip?'<br>'+esc(client.cityStateZip):''}${client.email?'<br>'+esc(client.email):''}</div></div><table><thead><tr><th>Description</th><th>Quantity</th><th>Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div class="row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>${t.discount?`<div class="row"><span>Discount</span><b>-${money(t.discount)}</b></div>`:''}${t.tax?`<div class="row"><span>Tax</span><b>${money(t.tax)}</b></div>`:''}<div class="row total"><span>Total due</span><b>${money(t.total)}</b></div></div>${invoice.notes||invoice.terms?`<div class="note">${invoice.notes?`<b>Note</b><br>${esc(invoice.notes).replace(/\n/g,'<br>')}<br><br>`:''}${invoice.terms?`<b>Payment terms</b><br>${esc(invoice.terms).replace(/\n/g,'<br>')}`:''}</div>`:''}</div><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    win.document.close();
  }

  document.addEventListener('click', async function (e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'close-modal-self' && e.target !== target) return;
    if (action === 'home') { e.preventDefault(); window.scrollTo(0,0); }
    if (action === 'open-auth') { state.authMode=target.dataset.mode||'login'; state.authError=''; state.modal='auth'; render(); }
    if (action === 'auth-tab') { state.authMode=target.dataset.mode; state.authError=''; render(); }
    if (action === 'close-modal' || action === 'close-modal-self') { state.modal=null; state.preview=null; state.authError=''; render(); }
    if (action === 'demo-login') { state.authMode='signup'; state.authError=''; state.modal='auth'; render(); }
    if (action === 'logout') {
      try { await supabaseClient.auth.signOut(); }
      catch (error) { flash(friendlyError(error)); }
      state.account=null; state.page='dashboard'; state.modal=null; render();
    }
    if (action === 'mobile-menu') { state.mobileOpen=!state.mobileOpen; render(); }
    if (action === 'nav') { state.page=target.dataset.page; state.mobileOpen=false; state.draft=null; render(); }
    if (action === 'new-invoice') { state.draft=newDraft(); state.page='editor'; state.mobileOpen=false; render(); }
    if (action === 'edit-invoice') { const inv=state.account.invoices.find(i=>i.id===target.dataset.id); if(inv){state.draft=JSON.parse(JSON.stringify(inv));state.page='editor';render();} }
    if (action === 'cancel-editor') { state.draft=null; state.page='invoices'; render(); }
    if (action === 'add-line') { syncEditorFromDOM(); state.draft.lines.push({id:uid('line'),description:'',quantity:1,rate:0}); render(); }
    if (action === 'remove-line') { syncEditorFromDOM(); if(state.draft.lines.length===1) return flash('An invoice needs at least one line item'); state.draft.lines=state.draft.lines.filter(l=>l.id!==target.dataset.id); render(); }
    if (action === 'preview-draft') { syncEditorFromDOM(); state.preview=JSON.parse(JSON.stringify(state.draft)); state.modal='preview'; render(); }
    if (action === 'preview-invoice') { const inv=state.account.invoices.find(i=>i.id===target.dataset.id); if(inv){state.preview=inv;state.modal='preview';render();} }
    if (action === 'delete-invoice') {
      const inv=state.account.invoices.find(i=>i.id===target.dataset.id);
      if(inv&&confirm(`Delete ${inv.invoiceNumber}?`)){
        try {
          await deleteInvoiceRemote(inv.id);
          state.account.invoices=state.account.invoices.filter(i=>i.id!==inv.id);
          render(); flash('Invoice deleted from the cloud');
        } catch (error) { flash(friendlyError(error)); }
      }
    }
    if (action === 'new-client') { state.modalClientId=null; state.modal='client'; render(); }
    if (action === 'edit-client') { state.modalClientId=target.dataset.id; state.modal='client'; render(); }
    if (action === 'delete-client') {
      const c=state.account.clients.find(x=>x.id===target.dataset.id); if(!c)return;
      if(state.account.invoices.some(i=>i.clientId===c.id)) return flash('Delete this client’s invoices first');
      if(confirm(`Delete ${c.company||c.name}?`)){
        try {
          await deleteClientRemote(c.id);
          state.account.clients=state.account.clients.filter(x=>x.id!==c.id);
          render(); flash('Client deleted from the cloud');
        } catch (error) { flash(friendlyError(error)); }
      }
    }
    if (action === 'mark-status') {
      const inv=state.account.invoices.find(i=>i.id===target.dataset.id);
      if(inv){
        try {
          const next={...inv,status:target.dataset.status};
          const saved=await saveInvoiceRemote(next);
          const index=state.account.invoices.findIndex(i=>i.id===saved.id);
          if(index>=0)state.account.invoices[index]=saved;
          state.preview=saved; render(); flash(`Invoice marked ${target.dataset.status}`);
        } catch (error) { flash(friendlyError(error)); }
      }
    }
    if (action === 'print-invoice') { if(state.preview) printInvoice(state.preview); }
    if (action === 'set-color') { const input=document.getElementById('profile-color'); if(input)input.value=target.dataset.color; document.querySelectorAll('.color-choice').forEach(x=>x.classList.toggle('active',x===target)); }
    if (action === 'billing-info') { alert('Connect this page to Stripe Checkout plus a server-side webhook before charging subscriptions. Never put a Stripe secret key in the website.'); }
  });

  document.addEventListener('submit', async function (e) {
    const formId = e.target.getAttribute('id');
    if (['auth-form', 'client-form', 'invoice-form', 'settings-form'].includes(formId)) e.preventDefault();

    const submitButton = e.target.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      if (formId === 'auth-form') {
        const fd=new FormData(e.target);
        const email=String(fd.get('email')||'').trim().toLowerCase();
        const password=String(fd.get('password')||'');
        state.authError='';

        if(state.authMode==='signup'){
          const name=String(fd.get('name')||'').trim();
          const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: name, business_name: name ? name + ' Services' : 'My Business' },
              emailRedirectTo: window.location.origin + window.location.pathname
            }
          });
          if (error) throw error;
          if (data.session && data.user) {
            state.account=await loadAccount(data.user);
            state.modal=null;
            state.page='dashboard';
            render();
            flash('Secure cloud account created');
          } else {
            state.authMode='login';
            state.authError='Account created. Check your email for the confirmation link, then log in.';
            render();
          }
        } else {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          state.account=await loadAccount(data.user);
          state.modal=null;
          state.page='dashboard';
          render();
          flash('Logged in securely');
        }
      }

      if (formId === 'client-form') {
        const fd=new FormData(e.target);
        const draft=Object.fromEntries(fd.entries());
        const saved=await saveClientRemote(draft);
        if(draft.id){
          const idx=state.account.clients.findIndex(c=>c.id===saved.id);
          if(idx>=0)state.account.clients[idx]=saved;
        }else{
          state.account.clients.unshift(saved);
        }
        state.modal=null;state.modalClientId=null;render();flash('Client saved to the cloud');
      }

      if (formId === 'invoice-form') await saveInvoiceDraft();

      if (formId === 'settings-form') {
        const fd=new FormData(e.target), data=Object.fromEntries(fd.entries());
        data.nextNumber=Number(data.nextNumber||1001);
        const saved=await saveProfileRemote({...state.account.profile,...data});
        state.account.profile=saved;
        state.account.name=saved.contactName || state.account.name;
        render();
        flash('Settings saved to the cloud');
      }
    } catch (error) {
      const message=friendlyError(error);
      if (formId === 'auth-form') {
        state.authError=message;
        state.modal='auth';
        render();
      } else {
        flash(message);
      }
    } finally {
      const currentButton = document.querySelector(`#${formId} [type="submit"]`);
      if (currentButton) currentButton.disabled = false;
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'invoice-search') { state.invoiceQuery=e.target.value; const pos=e.target.selectionStart; render(); const next=document.getElementById('invoice-search'); if(next){next.focus();next.setSelectionRange(pos,pos);} }
    if (e.target.id === 'client-search') { state.clientQuery=e.target.value; const pos=e.target.selectionStart; render(); const next=document.getElementById('client-search'); if(next){next.focus();next.setSelectionRange(pos,pos);} }
    if (e.target.matches('[data-line-field], [data-invoice-field="discount"], [data-invoice-field="taxRate"]')) updateEditorTotals();
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'invoice-filter') { state.invoiceFilter=e.target.value; render(); }
  });

  window.addEventListener('error', function (event) {
    console.error(event.error || event.message);
    if (app && !app.innerHTML.trim()) app.innerHTML='<div style="padding:40px;font-family:Arial"><h2>Verve Invoice could not load</h2><p>Check config.js, the browser console, and your Supabase project settings.</p></div>';
  });

  (async function boot() {
    if (!isConfigured || !supabaseClient) {
      state.booting=false;
      render();
      return;
    }
    try {
      await initializeSupabase();
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (data.session?.user) state.account=await loadAccount(data.session.user);
    } catch (error) {
      console.error(error);
      supabaseLibraryError=friendlyError(error);
      state.authError=friendlyError(error);
    } finally {
      state.booting=false;
      render();
    }
  })();
})();
