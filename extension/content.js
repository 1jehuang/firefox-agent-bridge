/* eslint-env browser */
function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function textIncludes(haystack, needleLower) {
  return haystack && needleLower && haystack.toLowerCase().includes(needleLower);
}

function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  // Must have non-zero dimensions
  if (rect.width === 0 || rect.height === 0) return false;
  // Must be within viewport (or at least partially)
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  // Check computed style
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function findByText(text) {
  if (!text) return null;
  const needleLower = text.toLowerCase();
  const root = document.body || document.documentElement;
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let fallback = null; // Store first match as fallback
  while (node) {
    if (textIncludes(node.nodeValue, needleLower)) {
      const el = node.parentElement || node.parentNode;
      if (isElementVisible(el)) {
        return el; // Return first VISIBLE match
      }
      if (!fallback) fallback = el; // Keep first match as fallback
    }
    node = walker.nextNode();
  }
  return fallback; // Return fallback if no visible match found
}

function resolveElement(params) {
  // Try primary selector first
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (el) return el;
  }

  // Try text match
  if (params.text) {
    const el = findByText(params.text);
    if (el) return el;
  }

  // Try coordinates
  if (Number.isFinite(params.x) && Number.isFinite(params.y)) {
    return document.elementFromPoint(params.x, params.y);
  }

  // Smart fallbacks if selector failed
  if (params.selector && params.smartFallback !== false) {
    // Try variations of the selector
    const fallbacks = generateSelectorFallbacks(params.selector);
    for (const fallback of fallbacks) {
      try {
        const el = document.querySelector(fallback);
        if (el) return el;
      } catch (e) { /* invalid selector */ }
    }

    // Last resort: try to find by partial text in selector
    const textMatch = params.selector.match(/["']([^"']+)["']/);
    if (textMatch) {
      const el = findByText(textMatch[1]);
      if (el) return el;
    }
  }

  return null;
}

function generateSelectorFallbacks(selector) {
  const fallbacks = [];

  // If it's an ID selector, try as class or name
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    fallbacks.push(`[id*="${id}"]`);  // Partial ID match
    fallbacks.push(`.${id}`);          // As class
    fallbacks.push(`[name="${id}"]`);  // As name
  }

  // If it's a class selector, try partial match
  if (selector.startsWith('.')) {
    const cls = selector.slice(1).split('.')[0];
    fallbacks.push(`[class*="${cls}"]`);
  }

  // If it's an attribute selector, try variations
  const attrMatch = selector.match(/\[(\w+)=["']?([^"'\]]+)["']?\]/);
  if (attrMatch) {
    const [, attr, value] = attrMatch;
    fallbacks.push(`[${attr}*="${value}"]`);  // Contains
    fallbacks.push(`[${attr}^="${value}"]`);  // Starts with
  }

  // Try aria-label if selector looks like a button/link
  if (selector.includes('button') || selector.includes('btn') || selector.includes('link')) {
    const textPart = selector.match(/[.#]([a-z-]+)/i);
    if (textPart) {
      const label = textPart[1].replace(/[-_]/g, ' ');
      fallbacks.push(`[aria-label*="${label}" i]`);
    }
  }

  return fallbacks;
}

function elementSummary(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    id: el.id || null,
    classes: el.className || null,
    text: el.innerText ? el.innerText.slice(0, 200) : null,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}

async function handleClick(params) {
  const target = resolveElement(params || {});
  if (!target) throw new Error("Element not found");
  if (params.scrollIntoView !== false && target.scrollIntoView) {
    target.scrollIntoView({ block: "center", inline: "center" });
  }
  if (target.focus) target.focus({ preventScroll: true });

  // Special handling for checkboxes and radio buttons - set .checked directly
  const isCheckbox = target.tagName === "INPUT" && target.type === "checkbox";
  const isRadio = target.tagName === "INPUT" && target.type === "radio";

  if (isCheckbox || isRadio) {
    const oldChecked = target.checked;
    if (isCheckbox) {
      // Toggle checkbox, or set to specific value if provided
      target.checked = params.checked !== undefined ? Boolean(params.checked) : !target.checked;
    } else {
      // Radio buttons are always set to checked
      target.checked = true;
    }
    // Dispatch change event if state changed
    if (target.checked !== oldChecked) {
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { clicked: true, checked: target.checked, element: elementSummary(target) };
  }

  // Standard click handling for other elements
  if (params.dispatchEvents !== false) {
    const eventInit = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new MouseEvent("mouseover", eventInit));
    target.dispatchEvent(new MouseEvent("mousedown", eventInit));
    target.dispatchEvent(new MouseEvent("mouseup", eventInit));
    target.dispatchEvent(new MouseEvent("click", eventInit));
  }
  if (typeof target.click === "function") target.click();

  return { clicked: true, element: elementSummary(target) };
}

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return (
    el.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    el.getAttribute("contenteditable") === "true"
  );
}

async function handleType(params) {
  if (!params || !params.text) throw new Error("Missing text parameter");
  const target = resolveElement(params || {});
  if (!target) throw new Error("Element not found");
  if (!isEditable(target)) throw new Error("Target element is not editable");

  if (params.scrollIntoView !== false && target.scrollIntoView) {
    target.scrollIntoView({ block: "center", inline: "center" });
  }
  if (target.focus) target.focus({ preventScroll: true });

  const text = String(params.text);
  const append = Boolean(params.append);
  const clear = params.clear !== false;

  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
    if (clear) target.textContent = "";
    target.textContent = append ? `${target.textContent}${text}` : text;
  } else {
    if (clear && "value" in target) target.value = "";
    if ("value" in target) {
      target.value = append ? `${target.value}${text}` : text;
    }
  }

  if (params.dispatchEvents !== false) {
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (params.submit) {
    // First try form submit if available
    if (target.form) {
      target.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      if (typeof target.form.submit === "function") target.form.submit();
    } else {
      // No form - simulate Enter key press (works for React/JS apps)
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(enterEvent);
      target.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true
      }));
    }
  }

  return { typed: true, element: elementSummary(target), length: text.length };
}

function getSelector(el) {
  if (!el) return null;
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  // Build a path-based selector
  const path = [];
  let current = el;
  while (current && current !== document.body && path.length < 3) {
    let selector = current.tagName.toLowerCase();
    if (current.className && typeof current.className === 'string') {
      const firstClass = current.className.split(' ').filter(c => c && !c.includes(':'))[0];
      if (firstClass) selector += `.${firstClass}`;
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

function isInteractable(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return true;
  if (tag === 'INPUT' && el.type !== 'hidden') return true;
  if (tag === 'TEXTAREA') return true;
  if (el.getAttribute('role') === 'button') return true;
  if (el.onclick || el.getAttribute('onclick')) return true;
  return false;
}

function getInteractableType(el) {
  const tag = el.tagName.toUpperCase();
  if (tag === 'A') return 'link';
  if (tag === 'BUTTON' || el.getAttribute('role') === 'button') return 'button';
  if (tag === 'INPUT') return `input:${el.type || 'text'}`;
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') return 'select';
  return 'clickable';
}

function findClickableParent(el, maxDepth = 3) {
  // Walk up to find if this element is inside a clickable parent
  let current = el;
  let depth = 0;
  while (current && depth < maxDepth) {
    if (isInteractable(current) && isElementVisible(current)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

function truncateUrl(url, maxLen = 60) {
  if (!url || url.length <= maxLen) return url;
  try {
    const u = new URL(url);
    // Just show pathname, truncated
    const path = u.pathname + u.search;
    if (path.length > maxLen) {
      return path.slice(0, maxLen - 3) + '...';
    }
    return path;
  } catch {
    return url.slice(0, maxLen - 3) + '...';
  }
}

function buildAnnotatedContent(root) {
  const lines = [];
  const seen = new Set();
  const processedElements = new WeakSet();

  function addInteractable(el) {
    if (processedElements.has(el)) return;
    processedElements.add(el);

    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 100);
    const type = getInteractableType(el);
    const selector = getSelector(el);

    // Create a unique key to avoid duplicates
    const key = `${type}:${text}:${selector}`;
    if (!text || seen.has(key)) return;
    seen.add(key);

    if (type === 'link') {
      // Truncate href, omit if we have a good selector
      const hasGoodSelector = selector && (selector.startsWith('#') || selector.startsWith('[name='));
      if (hasGoodSelector) {
        lines.push(`[${type}: "${text}" | selector: ${selector}]`);
      } else {
        const shortHref = truncateUrl(el.href);
        lines.push(`[${type}: "${text}" | href: ${shortHref} | selector: ${selector}]`);
      }
    } else if (type === 'input:checkbox' || type === 'input:radio') {
      // Show checked state for checkboxes and radio buttons
      const checked = el.checked ? 'true' : 'false';
      const label = text || el.name || el.id || 'unnamed';
      lines.push(`[${type}: "${label}" | checked: ${checked} | selector: ${selector}]`);
    } else if (type === 'select') {
      // Show selected option for dropdowns
      const selectedOption = el.options && el.options[el.selectedIndex];
      const selected = selectedOption ? selectedOption.text.slice(0, 50) : '';
      const label = text || el.name || el.id || 'unnamed';
      lines.push(`[${type}: "${label}" | selected: "${selected}" | selector: ${selector}]`);
    } else if (type.startsWith('input:') || type === 'textarea') {
      const value = el.value ? ` | value: "${el.value.slice(0, 50)}"` : '';
      lines.push(`[${type}: "${text || el.name || el.id || 'unnamed'}"${value} | selector: ${selector}]`);
    } else {
      lines.push(`[${type}: "${text}" | selector: ${selector}]`);
    }
  }

  function walk(node) {
    if (!node) return;

    // Skip hidden elements
    if (node.nodeType === Node.ELEMENT_NODE) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
    }

    // Handle text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) {
        // Check if this text is inside a clickable element
        const clickableParent = findClickableParent(node.parentElement);
        if (clickableParent && isElementVisible(clickableParent)) {
          addInteractable(clickableParent);
        } else {
          lines.push(text);
        }
      }
      return;
    }

    // Handle element nodes
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;

      // Check if this is an interactable element
      if (isInteractable(el) && isElementVisible(el)) {
        addInteractable(el);
        return; // Don't recurse into interactables
      }

      // Recurse into children
      for (const child of el.childNodes) {
        walk(child);
      }
    }
  }

  walk(root);

  // Clean up: remove excessive blank lines and join
  return lines
    .filter(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function handleGetContent(params) {
  const format = params && params.format ? params.format : "html";
  let target = null;
  if (params && params.selector) target = document.querySelector(params.selector);

  if (format === "title") {
    return { title: document.title, url: window.location.href };
  }

  const root = target || document.body || document.documentElement;

  if (format === "text") {
    const text = root.innerText;
    return { text, url: window.location.href, title: document.title };
  }

  if (format === "textFast") {
    const text = root.textContent;
    return { text, url: window.location.href, title: document.title };
  }

  if (format === "annotated") {
    const content = buildAnnotatedContent(root);
    return { content, url: window.location.href, title: document.title };
  }

  const html = target ? target.outerHTML : document.documentElement.outerHTML;
  return { html, url: window.location.href, title: document.title };
}

async function handleFillForm(params) {
  if (!params.fields || !Array.isArray(params.fields)) {
    throw new Error("Missing fields array");
  }

  const results = [];

  for (const field of params.fields) {
    const el = field.selector ? document.querySelector(field.selector) : null;
    if (!el) {
      results.push({ selector: field.selector, ok: false, error: "Element not found" });
      continue;
    }

    try {
      const tagName = el.tagName;
      const inputType = el.type ? el.type.toLowerCase() : "";

      // Handle different field types
      if (tagName === "INPUT" && inputType === "checkbox") {
        const shouldCheck = field.checked !== false && field.value !== false;
        if (el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        results.push({ selector: field.selector, ok: true, type: "checkbox", checked: el.checked });

      } else if (tagName === "INPUT" && inputType === "radio") {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({ selector: field.selector, ok: true, type: "radio", checked: true });

      } else if (tagName === "SELECT") {
        el.value = field.value || "";
        el.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({ selector: field.selector, ok: true, type: "select", value: el.value });

      } else if (tagName === "INPUT" && inputType === "file") {
        // File input - expects field.file with {name, type, data (base64)}
        if (!field.file || !field.file.data) {
          results.push({ selector: field.selector, ok: false, error: "Missing file data" });
          continue;
        }
        try {
          const byteString = atob(field.file.data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: field.file.type || "application/octet-stream" });
          const file = new File([blob], field.file.name || "file", { type: blob.type });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          el.files = dataTransfer.files;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          results.push({ selector: field.selector, ok: true, type: "file", filename: file.name });
        } catch (fileErr) {
          results.push({ selector: field.selector, ok: false, error: fileErr.message });
        }

      } else if (tagName === "TEXTAREA" || tagName === "INPUT") {
        // Text inputs and textareas
        el.focus();
        el.value = field.value || "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        results.push({ selector: field.selector, ok: true, type: "text", value: el.value });

      } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
        el.focus();
        el.textContent = field.value || "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        results.push({ selector: field.selector, ok: true, type: "contenteditable", value: el.textContent });

      } else {
        results.push({ selector: field.selector, ok: false, error: "Unknown field type" });
      }
    } catch (err) {
      results.push({ selector: field.selector, ok: false, error: err.message });
    }
  }

  const successCount = results.filter(r => r.ok).length;
  return { filled: true, results, success: successCount, total: params.fields.length };
}

async function handleWaitFor(params) {
  const timeout = params.timeout || 5000;
  const interval = params.interval || 100;
  const startTime = performance.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      // Check for selector
      if (params.selector) {
        const el = document.querySelector(params.selector);
        if (el) {
          return resolve({ found: true, selector: params.selector, element: elementSummary(el) });
        }
      }

      // Check for text
      if (params.text) {
        const el = findByText(params.text);
        if (el) {
          return resolve({ found: true, text: params.text, element: elementSummary(el) });
        }
      }

      // Check for text content contains
      if (params.contains) {
        const root = document.body || document.documentElement;
        if (root && root.textContent && root.textContent.toLowerCase().includes(params.contains.toLowerCase())) {
          return resolve({ found: true, contains: params.contains });
        }
      }

      // Check timeout
      if (performance.now() - startTime >= timeout) {
        return reject(new Error(`Timeout waiting for: ${params.selector || params.text || params.contains}`));
      }

      // Keep polling
      setTimeout(check, interval);
    };

    check();
  });
}

async function handleTryUntil(params) {
  if (!params.alternatives || !Array.isArray(params.alternatives)) {
    throw new Error("tryUntil requires alternatives array");
  }

  const timeout = params.timeout || 5000;
  const startTime = performance.now();
  const errors = [];

  // Try each alternative until one succeeds
  for (const alt of params.alternatives) {
    if (performance.now() - startTime > timeout) {
      break;
    }

    try {
      let result;
      switch (alt.action) {
        case "click":
          result = await handleClick(alt.params || {});
          break;
        case "type":
          result = await handleType(alt.params || {});
          break;
        case "waitFor":
          result = await handleWaitFor({ ...alt.params, timeout: Math.min(alt.params?.timeout || 1000, 2000) });
          break;
        default:
          continue;
      }

      // Success! Return with info about which alternative worked
      return {
        branch: true,
        success: true,
        alternativeIndex: params.alternatives.indexOf(alt),
        action: alt.action,
        result
      };
    } catch (err) {
      errors.push({ action: alt.action, params: alt.params, error: err.message });
    }
  }

  // All alternatives failed
  return {
    branch: true,
    success: false,
    errors,
    message: "All alternatives failed"
  };
}

function extractLinks(root, limit = 20) {
  const links = [];
  const seen = new Set();
  const anchors = root.querySelectorAll('a[href]');

  for (const a of anchors) {
    if (links.length >= limit) break;
    const href = a.href;
    const text = (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80);

    // Skip empty, javascript, anchor-only, or duplicate links
    if (!href || href.startsWith('javascript:') || href === '#' || seen.has(href)) continue;
    if (!text || text.length < 2) continue;

    seen.add(href);
    links.push({ href, text });
  }
  return links;
}

function extractPageSummary(maxChars = 500) {
  // Get main content area if it exists
  const main = document.querySelector('main, [role="main"], article, .content, #content') || document.body;

  // Get headings for structure
  const headings = [];
  main.querySelectorAll('h1, h2, h3').forEach((h, i) => {
    if (i < 6) headings.push(h.innerText.trim().slice(0, 60));
  });

  // Get first paragraph or main text
  let summary = '';
  const p = main.querySelector('p');
  if (p) {
    summary = p.innerText.trim().slice(0, maxChars);
  } else {
    summary = main.innerText.trim().slice(0, maxChars);
  }

  return { headings, summary };
}

async function handlePreexplore(params) {
  const root = document.body;
  if (!root) return { error: 'No body element' };

  const goal = (params.goal || '').toLowerCase();
  const maxLinks = params.maxLinks || 15;

  // Get page basics
  const url = window.location.href;
  const title = document.title;
  const { headings, summary } = extractPageSummary(params.summaryLength || 300);

  // Get all links
  const allLinks = extractLinks(root, 50);

  // Score and filter links by relevance to goal
  let rankedLinks = allLinks;
  if (goal) {
    rankedLinks = allLinks.map(link => {
      let score = 0;
      const textLower = link.text.toLowerCase();
      const hrefLower = link.href.toLowerCase();

      // Exact word match in text
      if (textLower.includes(goal)) score += 10;
      // Partial match
      goal.split(/\s+/).forEach(word => {
        if (word.length > 2 && textLower.includes(word)) score += 3;
        if (word.length > 2 && hrefLower.includes(word)) score += 2;
      });
      // Navigation-like links get bonus
      if (/nav|menu|sidebar/i.test(link.text)) score += 1;

      return { ...link, score };
    }).sort((a, b) => b.score - a.score);
  }

  // Get top links
  const topLinks = rankedLinks.slice(0, maxLinks).map(l => ({
    text: l.text,
    href: l.href,
    score: l.score || 0
  }));

  // Get key interactables (condensed)
  const forms = [];
  document.querySelectorAll('form').forEach((form, i) => {
    if (i >= 3) return;
    const inputs = [];
    form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((inp, j) => {
      if (j >= 5) return;
      inputs.push({
        type: inp.type || inp.tagName.toLowerCase(),
        name: inp.name || inp.placeholder || inp.id || ''
      });
    });
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    forms.push({
      action: form.action || '',
      inputs,
      submitText: submit ? (submit.innerText || submit.value || 'Submit').slice(0, 30) : null
    });
  });

  // Get key buttons (non-form)
  const buttons = [];
  document.querySelectorAll('button:not([type="submit"]), [role="button"]').forEach((btn, i) => {
    if (i >= 10) return;
    const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
    if (text && text.length > 1 && text.length < 50) {
      buttons.push(text);
    }
  });

  return {
    url,
    title,
    headings,
    summary,
    links: topLinks,
    forms,
    buttons: [...new Set(buttons)].slice(0, 10),
    goal: goal || null
  };
}

async function handleGetInteractables(params) {
  const root = params.selector ? document.querySelector(params.selector) : document.body;
  if (!root) return { elements: [] };

  const interactables = [];
  const seen = new Set();

  // Find clickable elements
  const clickables = root.querySelectorAll('button, a, [role="button"], [onclick], input[type="submit"], input[type="button"]');
  clickables.forEach((el, i) => {
    if (i > 50) return; // Limit
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 100);
    if (!text || seen.has(text)) return;
    seen.add(text);

    const selector = el.id ? `#${el.id}` :
                     el.className ? `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}` :
                     null;

    const rect = el.getBoundingClientRect();
    interactables.push({
      type: 'clickable',
      tag: el.tagName,
      text,
      selector,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    });
  });

  // Find input fields
  const inputs = root.querySelectorAll('input:not([type="hidden"]), textarea, select');
  inputs.forEach((el, i) => {
    if (i > 30) return;
    const name = el.name || el.id || el.placeholder || '';
    const label = el.labels?.[0]?.innerText || el.getAttribute('aria-label') || '';

    interactables.push({
      type: 'input',
      tag: el.tagName,
      inputType: el.type || 'text',
      name,
      label: label.slice(0, 50),
      selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : null,
      value: el.value?.slice(0, 50) || ''
    });
  });

  return {
    url: window.location.href,
    title: document.title,
    elements: interactables
  };
}

// Auth page detection patterns
const AUTH_URL_PATTERNS = [
  /\/login/i, /\/signin/i, /\/sign-in/i, /\/auth/i, /\/oauth/i,
  /\/authorize/i, /\/authenticate/i, /\/sso/i,
  /accounts\.google/i, /github\.com\/login/i, /microsoft.*login/i,
  /login\.microsoftonline/i, /auth0\.com/i, /okta\.com/i
];

const OAUTH_PROVIDERS = [
  { name: "Google", patterns: [/google/i, /gmail/i] },
  { name: "GitHub", patterns: [/github/i] },
  { name: "Microsoft", patterns: [/microsoft/i, /azure/i, /outlook/i] },
  { name: "Facebook", patterns: [/facebook/i, /meta/i] },
  { name: "Apple", patterns: [/apple/i, /icloud/i] },
  { name: "Twitter", patterns: [/twitter/i, /x\.com/i] }
];

function detectAuthType() {
  const url = window.location.href.toLowerCase();
  const body = document.body;

  // Check for 2FA page
  const has2FAIndicators = body && (
    body.innerText.match(/two.?factor|2fa|verification code|authenticator|security code/i) ||
    document.querySelector('input[name*="otp" i], input[name*="code" i], input[name*="totp" i]')
  );
  if (has2FAIndicators) return "2fa";

  // Check for password reset
  if (url.match(/reset|forgot|recover/i) && document.querySelector('input[type="password"], input[type="email"]')) {
    return "password-reset";
  }

  // Check for OAuth consent page
  if (url.match(/consent|authorize|permission|scope/i)) {
    return "oauth";
  }

  // Standard login
  const hasPassword = document.querySelector('input[type="password"]');
  const hasUsername = document.querySelector('input[name*="user" i], input[name*="email" i], input[name*="login" i], input[type="email"]');
  if (hasPassword || hasUsername) return "login";

  return null;
}

function detectProvider() {
  const url = window.location.href;
  const html = document.documentElement.outerHTML;

  for (const provider of OAUTH_PROVIDERS) {
    for (const pattern of provider.patterns) {
      if (pattern.test(url) || pattern.test(html.slice(0, 5000))) {
        return provider.name;
      }
    }
  }

  // Check for OAuth buttons
  const oauthButtons = [];
  document.querySelectorAll('button, a').forEach(el => {
    const text = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
    if (text.match(/sign in with|login with|continue with/i)) {
      for (const provider of OAUTH_PROVIDERS) {
        if (provider.patterns.some(p => p.test(text))) {
          oauthButtons.push(provider.name);
        }
      }
    }
  });

  return oauthButtons.length > 0 ? oauthButtons : null;
}

function findVisibleAccounts() {
  const accounts = [];
  const seen = new Set();

  // Email patterns
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // Check visible text (limited scope to avoid picking up unrelated emails)
  const searchAreas = [
    document.querySelector('[class*="account" i], [class*="profile" i], [class*="user" i]'),
    document.querySelector('header, nav, [role="banner"]'),
    document.querySelector('[data-email], [data-user]')
  ].filter(Boolean);

  for (const area of searchAreas) {
    const text = area.innerText || '';
    const matches = text.match(emailRegex) || [];
    for (const email of matches) {
      if (!seen.has(email)) {
        seen.add(email);
        accounts.push(email);
      }
    }
  }

  // Check pre-filled input fields
  document.querySelectorAll('input[type="email"], input[name*="email" i], input[name*="user" i]').forEach(input => {
    if (input.value && input.value.includes('@') && !seen.has(input.value)) {
      seen.add(input.value);
      accounts.push(input.value);
    }
  });

  // Check account picker/switcher elements
  document.querySelectorAll('[class*="account" i] img[alt], [class*="avatar" i][title]').forEach(el => {
    const text = el.alt || el.title || '';
    const match = text.match(emailRegex);
    if (match && !seen.has(match[0])) {
      seen.add(match[0]);
      accounts.push(match[0]);
    }
  });

  return accounts.slice(0, 5); // Limit to 5 accounts
}

function getFormFields() {
  const fields = [];
  document.querySelectorAll('input:not([type="hidden"]):not([type="submit"])').forEach(input => {
    const type = input.type || 'text';
    const name = input.name || input.id || input.placeholder || type;
    if (!fields.includes(name)) {
      fields.push(name);
    }
  });
  return fields.slice(0, 10);
}

function getOAuthOptions() {
  const options = [];
  const seen = new Set();

  document.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
    if (text.match(/sign in with|login with|continue with/i)) {
      const providerMatch = text.match(/with\s+(\w+)/i);
      if (providerMatch && !seen.has(providerMatch[1])) {
        seen.add(providerMatch[1]);
        options.push(providerMatch[1]);
      }
    }
  });

  return options;
}

async function handleDetectAuth() {
  const url = window.location.href;

  // Check if URL matches auth patterns
  const isAuthUrl = AUTH_URL_PATTERNS.some(p => p.test(url));

  // Detect auth type from page content
  const authType = detectAuthType();
  const isAuthPage = isAuthUrl || authType !== null;

  if (!isAuthPage) {
    return {
      isAuthPage: false,
      authType: null,
      detectedProvider: null,
      availableAccounts: [],
      formFields: [],
      oauthOptions: []
    };
  }

  return {
    isAuthPage: true,
    authType: authType || "login",
    detectedProvider: detectProvider(),
    availableAccounts: findVisibleAccounts(),
    formFields: getFormFields(),
    oauthOptions: getOAuthOptions()
  };
}

async function handleEvaluate(params) {
  if (!params || !params.script) {
    throw new Error("Missing script parameter");
  }

  try {
    // Use Function constructor to evaluate in global scope
    // This is safer than eval() and works similarly
    const fn = new Function(params.script);
    const result = fn();

    // Handle promises
    const resolvedResult = result instanceof Promise ? await result : result;

    // Serialize the result appropriately
    if (resolvedResult === undefined) {
      return { result: null, type: 'undefined' };
    }
    if (resolvedResult === null) {
      return { result: null, type: 'null' };
    }
    if (typeof resolvedResult === 'function') {
      return { result: resolvedResult.toString(), type: 'function' };
    }
    if (resolvedResult instanceof Element) {
      return { result: elementSummary(resolvedResult), type: 'element' };
    }
    if (resolvedResult instanceof NodeList || resolvedResult instanceof HTMLCollection) {
      return { result: Array.from(resolvedResult).map(el => elementSummary(el)), type: 'nodelist' };
    }

    // Try to serialize as JSON, fallback to string
    try {
      // Test if it's JSON-serializable
      JSON.stringify(resolvedResult);
      return { result: resolvedResult, type: typeof resolvedResult };
    } catch {
      return { result: String(resolvedResult), type: 'string' };
    }
  } catch (err) {
    throw new Error(`Evaluate error: ${err.message}`);
  }
}

async function handleScroll(params) {
  if (!params) {
    throw new Error("Missing scroll parameters");
  }

  // Scroll by pixel amount
  if (params.y !== undefined || params.x !== undefined) {
    window.scrollBy({
      left: params.x || 0,
      top: params.y || 0,
      behavior: params.behavior || 'auto'
    });
    return {
      scrolled: true,
      type: 'by',
      x: params.x || 0,
      y: params.y || 0,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  }

  // Scroll element into view
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (!el) {
      throw new Error(`Element not found: ${params.selector}`);
    }
    el.scrollIntoView({
      block: params.block || 'center',
      inline: params.inline || 'center',
      behavior: params.behavior || 'auto'
    });
    return {
      scrolled: true,
      type: 'element',
      selector: params.selector,
      element: elementSummary(el)
    };
  }

  // Scroll to position (top/bottom)
  if (params.position) {
    const pos = params.position.toLowerCase();
    if (pos === 'top') {
      window.scrollTo({ top: 0, left: 0, behavior: params.behavior || 'auto' });
    } else if (pos === 'bottom') {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        left: 0,
        behavior: params.behavior || 'auto'
      });
    } else if (pos === 'left') {
      window.scrollTo({ top: window.scrollY, left: 0, behavior: params.behavior || 'auto' });
    } else if (pos === 'right') {
      window.scrollTo({
        top: window.scrollY,
        left: document.documentElement.scrollWidth,
        behavior: params.behavior || 'auto'
      });
    } else {
      throw new Error(`Unknown position: ${params.position}. Use top, bottom, left, or right.`);
    }
    return {
      scrolled: true,
      type: 'position',
      position: pos,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  }

  // Scroll to absolute coordinates
  if (params.scrollTo) {
    window.scrollTo({
      top: params.scrollTo.y || 0,
      left: params.scrollTo.x || 0,
      behavior: params.behavior || 'auto'
    });
    return {
      scrolled: true,
      type: 'absolute',
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  }

  throw new Error('scroll requires y/x (relative), selector, position (top/bottom), or scrollTo ({x, y})');
}

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "agent-bridge") return undefined;
  const params = message.params || {};
  const profile = Boolean(message.profile || params.profile);
  const started = profile ? performance.now() : 0;

  const run = async () => {
    switch (message.action) {
      case "click":
        return handleClick(params);
      case "type":
        return handleType(params);
      case "getContent":
        return handleGetContent(params);
      case "waitFor":
        return handleWaitFor(params);
      case "fillForm":
        return handleFillForm(params);
      case "tryUntil":
      case "branch":  // Legacy alias
        return handleTryUntil(params);
      case "getInteractables":
        return handleGetInteractables(params);
      case "preexplore":
        return handlePreexplore(params);
      case "detectAuth":
        return handleDetectAuth();
      case "evaluate":
        return handleEvaluate(params);
      case "scroll":
        return handleScroll(params);
      default:
        throw new Error(`Unknown content action: ${message.action}`);
    }
  };

  return run().then((result) => {
    if (!profile) return result;
    const timing = { contentMs: roundMs(performance.now() - started) };
    if (result && typeof result === "object") {
      result.__timing = timing;
      return result;
    }
    return { value: result, __timing: timing };
  });
});
