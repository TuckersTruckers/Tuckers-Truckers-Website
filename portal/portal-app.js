/**
 * Shared owner-portal navigation and routing foundation.
 *
 * This module owns the owner navigation UI and delegates page/panel changes
 * to the dashboard so existing panel behavior remains in place during the
 * staged migration away from standalone iframe pages.
 */

export function setupOwnerNavigation({ onShowPanel, onOpenPage }) {
  const appLayout = document.querySelector('.app-layout');
  const primary = document.getElementById('tabs');
  const secondary = document.getElementById('secondary-nav');
  const secondarySidebar = document.getElementById('secondary-sidebar');
  const secondaryTitle = document.getElementById('secondary-nav-title');
  const secondaryCopy = document.getElementById('secondary-nav-copy');
  const frame = document.getElementById('owner-content-frame');

  if (!appLayout || !primary || !secondary || !secondarySidebar || !secondaryTitle || !secondaryCopy || !frame) {
    console.error('Owner navigation could not initialize because a required portal element is missing.');
    return;
  }

  appLayout.classList.add('owner-navigation');

  frame.addEventListener('load', () => {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      const style = doc.createElement('style');
      style.textContent = 'header,footer,.portal-sidebar,.portal-topbar{display:none!important}.portal-main{margin:0!important}.portal-main .wrap,main{width:100%!important;max-width:none!important;margin:0!important;padding:22px!important}.portal-footer{display:none!important}body{background:#f5f5f5!important}';
      doc.head.append(style);
    } catch (error) {
      console.warn('Portal section styling could not be applied.', error);
    }
  });

  const sections = {
    Dashboard: {
      copy: 'Your operations at a glance.',
      groups: [{ heading: 'OVERVIEW', items: [['Overview', 'panel', 'overview']] }]
    },
    'Load Board': {
      copy: 'Load search and dispatch workflows.',
      groups: [{ heading: 'LOAD MANAGEMENT', items: [['Load Board', 'panel', 'loads'], ['Quotes', 'panel', 'quotes']] }]
    },
    Carriers: {
      copy: 'Manage carrier records, onboarding, and approvals.',
      groups: [
        { heading: 'OVERVIEW', items: [['Carrier Directory', 'page', 'carriers.html']] },
        { heading: 'CARRIER MANAGEMENT', items: [['Add New Carrier', 'page', 'admin.html#carrier-panel'], ['Pending Approvals', 'page', 'pending-accounts.html'], ['Carrier Inquiries', 'page', 'inquiries.html']] }
      ]
    },
    Finance: {
      copy: 'Financial tools and carrier settlement workflows.',
      groups: [{ heading: 'FINANCIAL WORKSPACE', items: [['Overview', 'panel', 'factoring'], ['Factoring', 'panel', 'factoring'], ['Expenses', 'panel', 'expenses']] }]
    },
    Administration: {
      copy: 'Control account provisioning, assignments, and platform access.',
      groups: [{ heading: 'PLATFORM ADMINISTRATION', items: [['Account Provisioning', 'page', 'admin.html#carrier-panel'], ['Driver & Carrier Assignments', 'page', 'admin.html#driver-panel'], ['Dispatcher Access', 'page', 'admin.html#dispatcher-assignment-section']] }]
    }
  };

  const primaryItems = [
    ['Dashboard', 'layout-dashboard'],
    ['Load Board', 'clipboard-list'],
    ['Carriers', 'truck'],
    ['Finance', 'wallet'],
    ['Administration', 'settings']
  ];

  function renderSecondary(section, activeLabel) {
    const config = sections[section];
    secondaryTitle.textContent = section;
    secondaryCopy.textContent = config.copy;
    secondary.replaceChildren();

    for (const group of config.groups) {
      const heading = document.createElement('div');
      heading.className = 'secondary-group-heading';
      heading.textContent = group.heading;
      secondary.append(heading);

      for (const item of group.items) {
        const [label, kind, target] = item;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-nav-link' + (label === activeLabel ? ' active' : '');
        button.textContent = label;
        button.addEventListener('click', () => {
          document.querySelectorAll('.secondary-nav-link').forEach(element => {
            element.classList.toggle('active', element === button);
          });
          if (kind === 'page') onOpenPage(target, label);
          else onShowPanel(target);
        });
        secondary.append(button);
      }
    }

    secondarySidebar.hidden = false;
  }

  const primarySidebar = appLayout.querySelector('.sidebar');
  if (primarySidebar) {
    primarySidebar.addEventListener('pointerleave', () => {
      appLayout.classList.remove('owner-primary-just-selected');
    });
  }

  function selectSection(section) {
    document.querySelectorAll('.primary-nav-link').forEach(element => {
      element.classList.toggle('active', element.dataset.section === section);
    });

    if (section === 'Dashboard') {
      appLayout.classList.remove('owner-primary-just-selected');
      appLayout.classList.remove('owner-secondary-open');
      document.body.classList.remove('owner-secondary-open');
      secondarySidebar.hidden = true;
      onShowPanel('overview');
      return;
    }

    const config = sections[section];
    if (!config) return;

    appLayout.classList.add('owner-secondary-open', 'owner-primary-just-selected');
    document.body.classList.add('owner-secondary-open');

    const first = config.groups.flatMap(group => group.items)[0];
    renderSecondary(section, first[0]);
    if (first[1] === 'page') onOpenPage(first[2], first[0]);
    else onShowPanel(first[2]);
  }

  primary.replaceChildren();

  for (const [label] of primaryItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-nav-link';
    button.dataset.section = label;
    button.innerHTML = '<span class="primary-nav-icon" aria-hidden="true"></span><span></span>';
    button.querySelector('.primary-nav-icon').textContent = ({
      Dashboard: '⌂',
      'Load Board': '▤',
      Carriers: '▰',
      Finance: '＄',
      Administration: '⚙'
    })[label];
    button.querySelector('span:last-child').textContent = label;
    button.addEventListener('click', () => {
      button.blur();
      selectSection(label);
    });
    primary.append(button);
  }

  primary.hidden = false;

  const shell = appLayout.querySelector('.shell');
  if (shell) {
    shell.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || event.defaultPrevented) return;

      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || /^(?:[a-z]+:|\\/\\/)/i.test(href)) return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.includes('/portal/')) return;

      event.preventDefault();
      onOpenPage(url.pathname.split('/portal/')[1] + url.hash, link.textContent.trim() || 'Portal section');
    });
  }

  selectSection('Dashboard');
}
