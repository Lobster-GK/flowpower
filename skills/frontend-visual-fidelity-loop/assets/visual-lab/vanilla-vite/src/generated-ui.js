import './generated-ui.css';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderGeneratedUi(root, fixture) {
  const rows = fixture.rows.map((row) => `
    <tr data-visual-id="row-${escapeHtml(row.id)}">
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.role)}</td>
      <td><span class="status">${escapeHtml(row.status)}</span></td>
    </tr>
  `).join('');

  root.innerHTML = `
    <main class="page" data-visual-id="page-root">
      <header class="page-header" data-visual-id="page-header">
        <div>
          <h1 data-visual-id="page-title">${escapeHtml(fixture.title)}</h1>
          <p data-visual-id="page-subtitle">${escapeHtml(fixture.subtitle)}</p>
        </div>
        <button type="button" data-visual-id="primary-action">${escapeHtml(fixture.primaryAction)}</button>
      </header>
      <section class="table-card" data-visual-id="users-table">
        <table>
          <thead>
            <tr><th>姓名</th><th>角色</th><th>状态</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <footer data-visual-id="pagination">${escapeHtml(fixture.paginationText)}</footer>
      </section>
    </main>
  `;
}
