'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const APP_JS_PATH = path.join(ROOT, 'js', 'app.js');

/**
 * Loads the real index.html into a fresh jsdom document and evaluates the
 * real js/app.js source inside that window — the same code that ships to
 * browsers, not a reimplementation. Fires DOMContentLoaded manually since
 * jsdom's own one already fired during initial parse (before app.js, which
 * we inject after construction, could register its listener).
 *
 * confirm() is stubbed to return true by default (jsdom's native confirm()
 * logs "not implemented" and returns undefined/falsy, which would silently
 * skip any code gated on it, e.g. the "reset data" button).
 */
function loadApp({ confirmReturns = true } = {}) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  // runScripts: 'dangerously' is required for window.eval() below to actually
  // execute inside this window's own VM context (document/localStorage etc.);
  // without it, eval() silently falls back to Node's outer global scope.
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously' });
  const { window } = dom;

  window.confirm = () => confirmReturns;

  const appJsSource = fs.readFileSync(APP_JS_PATH, 'utf8');
  window.eval(appJsSource);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

  return dom;
}

function click(dom, id) {
  const el = dom.window.document.getElementById(id);
  if (!el) throw new Error(`No element with id="${id}"`);
  el.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
}

function clickAll(dom, selector) {
  dom.window.document.querySelectorAll(selector).forEach(el => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
  });
}

function clickSelector(dom, selector) {
  const el = dom.window.document.querySelector(selector);
  if (!el) throw new Error(`No element matching "${selector}"`);
  el.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
}

function setValue(dom, id, value) {
  const el = dom.window.document.getElementById(id);
  el.value = value;
}

function setChecked(dom, id, checked) {
  const el = dom.window.document.getElementById(id);
  el.checked = checked;
}

function fireEvent(dom, id, eventName) {
  const el = dom.window.document.getElementById(id);
  el.dispatchEvent(new dom.window.Event(eventName, { bubbles: true, cancelable: true }));
}

function text(dom, id) {
  const el = dom.window.document.getElementById(id);
  return el ? el.textContent.trim() : null;
}

function submitForm(dom, id) {
  const form = dom.window.document.getElementById(id);
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

/** Adds `name` via the real UI form (not the exported addPlayer()) so the submit-handler wiring is covered too. */
function addPlayerViaUi(dom, name) {
  setValue(dom, 'input-player-name', name);
  submitForm(dom, 'form-add-player');
}

module.exports = {
  loadApp, click, clickAll, clickSelector, setValue, setChecked, fireEvent, text, submitForm, addPlayerViaUi
};
