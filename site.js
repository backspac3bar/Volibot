const search = document.querySelector('#command-search');
const filters = [...document.querySelectorAll('.filter')];
const commands = [...document.querySelectorAll('.command')];
const count = document.querySelector('#result-count');
const empty = document.querySelector('#no-results');
let category = 'all';
function filterCommands() {
  const query = search.value.trim().toLocaleLowerCase('ko');
  let visible = 0;
  for (const command of commands) {
    const matches = (category === 'all' || command.dataset.category === category)
      && command.textContent.toLocaleLowerCase('ko').includes(query);
    command.hidden = !matches;
    if (matches) visible += 1;
  }
  count.textContent = `${visible}개 명령어`;
  empty.hidden = visible !== 0;
}
search.addEventListener('input', filterCommands);
for (const button of filters) {
  button.addEventListener('click', () => {
    category = button.dataset.category;
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter === button));
    filterCommands();
  });
}
filterCommands();

const featureTabs = [...document.querySelectorAll('.feature-nav [role="tab"]')];
const featurePanels = [...document.querySelectorAll('.grid [role="tabpanel"]')];
function selectFeature(tab, moveFocus = false) {
  const selectedId = tab.getAttribute('aria-controls');
  for (const item of featureTabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  for (const panel of featurePanels) {
    panel.hidden = panel.id !== selectedId;
    panel.tabIndex = panel.hidden ? -1 : 0;
  }
  if (moveFocus) tab.focus();
}
for (const [index, tab] of featureTabs.entries()) {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    selectFeature(tab);
    history.replaceState(null, '', tab.hash);
  });
  tab.addEventListener('keydown', (event) => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % featureTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + featureTabs.length) % featureTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = featureTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = featureTabs[nextIndex];
    selectFeature(nextTab, true);
    history.replaceState(null, '', nextTab.hash);
  });
}
function selectFeatureFromHash() {
  const matchingTab = featureTabs.find((tab) => tab.hash === location.hash);
  if (matchingTab) selectFeature(matchingTab);
}
if (featureTabs.length) {
  selectFeature(featureTabs.find((tab) => tab.hash === location.hash) || featureTabs[0]);
  window.addEventListener('hashchange', selectFeatureFromHash);
}
