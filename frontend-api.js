/* Passage REST API helper. Include this script before the prototype app script when integrating. */
window.PassageAPI = (() => {
  const BASE = window.PASSAGE_API_URL || 'http://localhost:4000/api';
  const TOKEN_KEY = 'passage_access_token';
  const token = () => localStorage.getItem(TOKEN_KEY);
  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`${BASE}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  return {
    setToken(value) { localStorage.setItem(TOKEN_KEY, value); },
    clearToken() { localStorage.removeItem(TOKEN_KEY); },
    register: body => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    me: () => request('/auth/me'),
    profile: () => request('/profile'),
    updateProfile: body => request('/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    saveSkills: skills => request('/profile/skills', { method: 'PUT', body: JSON.stringify({ skills }) }),
    opportunities: params => request(`/opportunities${params ? `?${new URLSearchParams(params)}` : ''}`),
    createOpportunity: body => request('/opportunities', { method: 'POST', body: JSON.stringify(body) }),
    matches: id => request(`/opportunities/${encodeURIComponent(id)}/matches`),
    apply: id => request(`/opportunities/${encodeURIComponent(id)}/apply`, { method: 'POST' }),
    applications: () => request('/applications'),
    updateApplication: (id, status) => request(`/applications/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    assign: body => request('/assignments', { method: 'POST', body: JSON.stringify(body) }),
    growthRecords: () => request('/growth-records'),
    addGrowthRecord: body => request('/growth-records', { method: 'POST', body: JSON.stringify(body) }),
    createPassportSnapshot: () => request('/passport/snapshot', { method: 'POST' }),
    passportVersions: () => request('/passport/versions'),
    hrAnalytics: () => request('/hr/analytics'),
    hrUsers: () => request('/hr/users')
  };
})();
