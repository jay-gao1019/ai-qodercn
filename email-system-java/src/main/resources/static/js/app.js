(function() {
  const mainContent = document.getElementById('main-content');
  const sidebarEl = document.getElementById('sidebar');

  const pages = {
    dashboard: DashboardPage,
    smtp: SMTPPage,
    customers: CustomersPage,
    templates: TemplatesPage,
    campaigns: CampaignsPage,
  };

  const pageBinders = {
    dashboard: bindDashboardEvents,
    smtp: bindSmtpEvents,
    customers: bindCustomersEvents,
    templates: bindTemplatesEvents,
    campaigns: bindCampaignsEvents,
  };

  const router = {
    current: null,
    navigate(page) {
      this.current = page;
      sidebarEl.innerHTML = sidebar.render(page);
      sidebar.bind();
      const render = pages[page];
      if (render) {
        mainContent.innerHTML = render();
        const binder = pageBinders[page];
        if (binder) binder();
      }
    }
  };

  window.router = router;

  window.showToast = function(msg, type = 'info', duration = 2500) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.className = 'toast', duration);
  };

  router.navigate('dashboard');
})();
