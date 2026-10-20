import fixture from './visual-fixture.json';
import './runtime.css';
import { renderGeneratedUi } from './generated-ui.js';

const root = document.querySelector('#visual-lab-root');

if (!root) {
  throw new Error('Visual Lab root was not found');
}

renderGeneratedUi(root, fixture);

document.documentElement.dataset.visualLabReady = 'true';
