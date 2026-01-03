/* eslint-env browser */
function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function textIncludes(haystack, needleLower) {
  return haystack && needleLower && haystack.toLowerCase().includes(needleLower);
}

function findByText(text) {
  if (!text) return null;
  const needleLower = text.toLowerCase();
  const root = document.body || document.documentElement;
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (textIncludes(node.nodeValue, needleLower)) {
      return node.parentElement || node.parentNode;
    }
    node = walker.nextNode();
  }
  return null;
}

function resolveElement(params) {
  if (params.selector) return document.querySelector(params.selector);
  if (params.text) return findByText(params.text);
  if (Number.isFinite(params.x) && Number.isFinite(params.y)) {
    return document.elementFromPoint(params.x, params.y);
  }
  return null;
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

async function handleGetContent(params) {
  const format = params && params.format ? params.format : "html";
  let target = null;
  if (params && params.selector) target = document.querySelector(params.selector);

  if (format === "title") {
    return { title: document.title, url: window.location.href };
  }

  const root = document.body || document.documentElement;

  if (format === "text") {
    const text = target ? target.innerText : root.innerText;
    return { text, url: window.location.href, title: document.title };
  }

  if (format === "textFast") {
    const text = target ? target.textContent : root.textContent;
    return { text, url: window.location.href, title: document.title };
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
