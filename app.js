class HKTRApp {
  constructor() {
    this.state = {
      providerKey: 'ctb',
      query: '',
      loading: false,
      error: '',
      result: null
    };

    this.providers = {};
    this.bindUI();
    this.render();
  }

  bindUI() {
    document.addEventListener('DOMContentLoaded', () => {
      this.input = document.getElementById('routeInput');
      this.searchBtn = document.getElementById('searchBtn');
      this.tabBtns = document.querySelectorAll('[data-provider]');
      this.resultBox = document.getElementById('resultBox');

      if (this.searchBtn) {
        this.searchBtn.addEventListener('click', () => this.handleSearch());
      }

      if (this.input) {
        this.input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.handleSearch();
        });
      }

      this.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.providerKey = btn.dataset.provider;
          this.renderTabs();
        });
      });

      this.renderTabs();
    });
  }

  registerProvider(key, provider) {
    this.providers[key] = provider;
  }

  getProvider() {
    return this.providers[this.state.providerKey] || null;
  }

  async handleSearch() {
    const q = (this.input?.value || '').trim();
    if (!q) return;

    this.state.query = q;
    this.state.loading = true;
    this.state.error = '';
    this.state.result = null;
    this.render();

    try {
      const provider = this.getProvider();
      if (!provider) throw new Error('未有可用 provider');

      const result = await provider.search(q);
      this.state.result = result;
    } catch (err) {
      this.state.error = err.message || '搜尋失敗';
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  renderTabs() {
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.provider === this.state.providerKey);
    });
  }

  render() {
    if (!this.resultBox) return;

    if (this.state.loading) {
      this.resultBox.innerHTML = '<div class="hint">載入中...</div>';
      return;
    }

    if (this.state.error) {
      this.resultBox.innerHTML = `<div class="error">⚠️ ${this.state.error}</div>`;
      return;
    }

    if (!this.state.result) {
      this.resultBox.innerHTML = '<div class="hint">無實時數據</div>';
      return;
    }

    this.resultBox.innerHTML = this.renderResult(this.state.result);
  }

  renderResult(result) {
    if (this.state.providerKey === 'ctb') {
      const etas = (result.etaList || []).map(x => `<li>${x.time || '-'} ${x.status || ''}</li>`).join('');
      return `
        <div class="card">
          <div>Citybus</div>
          <div>Route: ${result.route || this.state.query}</div>
          <ul>${etas || '<li>無 ETA</li>'}</ul>
        </div>
      `;
    }

    return `
      <div class="card">
        <div>${this.state.providerKey.toUpperCase()}</div>
        <pre>${JSON.stringify(result, null, 2)}</pre>
      </div>
    `;
  }
}

window.hktrApp = new HKTRApp();
