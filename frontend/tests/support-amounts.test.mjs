import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const result = await build({
  stdin: { contents: 'export {default as PaymentMethods, KakaoSupportPanel} from "./src/desk2/CoffeePaymentMethods"; export * from "./src/desk2/supportAmounts";', resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  plugins: [{ name: 'korean-copy-only', setup(builder) {
    // Keep language and application/router side effects out of this isolated component check.
    builder.onResolve({ filter: /^\.\/lib$/ }, () => ({ path: 'copy', namespace: 'copy' }));
    builder.onLoad({ filter: /.*/, namespace: 'copy' }, () => ({ contents: 'export const useL = () => (ko, en) => ko;', loader: 'js' }));
  } }],
});
const module = { exports: {} };
vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require });
const { PaymentMethods, KakaoSupportPanel, KAKAO_SUPPORT_OPTIONS: options, DEFAULT_KAKAO_SUPPORT: initial } = module.exports;

function elements(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => elements(child, predicate))];
}

test('support opens on Kakao Pay with 3000 KRW selected and the alternative available', () => {
  const html = renderToStaticMarkup(React.createElement(PaymentMethods));
  assert.match(html, /id="coffee-tab-kakaopay"[^>]*aria-selected="true"/);
  assert.match(html, /id="coffee-panel-buymeacoffee"[^>]*hidden=""/);
  assert.match(html, /checked=""[^>]*value="3000"/);
  assert.ok(html.indexOf('coffee-tab-kakaopay') < html.indexOf('coffee-tab-buymeacoffee'));
  assert.ok(html.includes('/api/support/buymeacoffee/checkout/583316'));
  assert.equal(initial.amount, 3000);
});

test('every amount selection changes the button, QR target, visible QR and selected radio together', () => {
  assert.deepEqual(Array.from(options, option => option.amount), [3000, 5000, 7000, 10000, null]);
  let selected = initial;
  for (const option of [...options, initial]) {
    const tree = KakaoSupportPanel({ selected, onSelect: next => { selected = next; } });
    const radio = elements(tree, node => node.type === 'input' && node.props.value === (option.amount ?? 'other'))[0];
    radio.props.onChange();
    const updated = KakaoSupportPanel({ selected, onSelect() {} });
    const links = elements(updated, node => node.type === 'a');
    assert.ok(links.every(link => link.props.href === option.url));
    const visible = elements(updated, node => node.type === 'img' && !node.props.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].props.src, option.qr);
    const checked = elements(updated, node => node.type === 'input' && node.props.checked);
    assert.equal(checked.length, 1);
    assert.equal(checked[0].props.value, option.amount ?? 'other');
  }
});

test('links keep the original recipient and encode each selected amount without arbitrary destinations', () => {
  for (const option of options) {
    const url = new URL(option.url);
    assert.equal(url.origin, 'https://qr.kakaopay.com');
    assert.equal(url.pathname, option.amount === null ? '/Ej7w8lXu2' : `/Ej7w8lXu2${(option.amount * 8).toString(16)}0000`);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
});

test('Other restores the original unrestricted link and QR with no stale preset in the copy', () => {
  const other = options.find(option => option.amount === null);
  const html = renderToStaticMarkup(React.createElement(KakaoSupportPanel, { selected: other, onSelect() {} }));
  assert.equal(other.url, 'https://qr.kakaopay.com/Ej7w8lXu2');
  assert.equal(other.qr, '/img/support/kakaopay-other.png');
  assert.match(html, /checked=""[^>]*value="other"/);
  assert.ok(html.includes('원하는 금액으로 후원하기'));
  assert.ok(html.includes('직접 입력해 주세요'));
  assert.ok(!html.includes('3,000원 후원하기'));
  assert.ok(!html.includes('0원 후원하기'));
});
