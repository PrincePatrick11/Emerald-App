// The page half of the dev bridge (see devbridge.rs). Injected into every
// document of a build that has the `devbridge` feature; a release build does
// not contain it.
(function () {
  if (window.__emeraldBridge) return;

  // Evaluation results that are not plain data stay here until the client
  // asks for them by id, the way a DevTools object handle works.
  var objects = {};
  var nextObject = 1;
  var started = {};
  var hovered = null;
  // Set while a script from the bridge is being tried as an expression: one
  // that turns out to be statements fails to parse, and that is no error of
  // the app's.
  var probing = false;

  function invoke(command, args) {
    try {
      var sent = window.__TAURI_INTERNALS__.invoke(command, args);
      if (sent && sent.catch) sent.catch(function () {});
    } catch (e) {
      // No IPC yet, or none any more: there is nobody to tell.
    }
  }

  function emit(method, params) {
    invoke('devbridge_event', { payload: JSON.stringify({ method: method, params: params }) });
  }

  function errorText(e) {
    if (e && typeof e === 'object' && 'message' in e) return (e.name || 'Error') + ': ' + e.message;
    return String(e);
  }

  // ── Console ────────────────────────────────────────────────────────────

  var CONSOLE_ARG_MAX = 2000;

  function consoleArg(value) {
    if (typeof value === 'string') return { type: 'string', value: value };
    if (value === undefined) return { type: 'undefined' };
    if (value instanceof Error) return { type: 'string', value: errorText(value) };
    if (typeof value === 'function') return { type: 'function', description: 'function ' + (value.name || '') };
    try {
      var text = JSON.stringify(value);
      if (text === undefined) return { type: typeof value, description: String(value) };
      if (text.length > CONSOLE_ARG_MAX) return { type: 'string', value: text.slice(0, CONSOLE_ARG_MAX) + '…' };
      return { type: typeof value, value: JSON.parse(text) };
    } catch (e) {
      return { type: typeof value, description: Object.prototype.toString.call(value) };
    }
  }

  var levels = { log: 'log', info: 'info', warn: 'warning', error: 'error', debug: 'debug' };
  Object.keys(levels).forEach(function (name) {
    var original = console[name];
    console[name] = function () {
      try {
        emit('Runtime.consoleAPICalled', { type: levels[name], args: Array.prototype.map.call(arguments, consoleArg) });
      } catch (e) {
        // Reporting must never break the call it reports.
      }
      return original.apply(console, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    if (probing && /SyntaxError/.test(String(e.message))) return;
    emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Uncaught',
        url: e.filename || undefined,
        lineNumber: (e.lineno || 1) - 1,
        exception: { description: e.error ? errorText(e.error) : String(e.message) },
      },
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    emit('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught (in promise)', exception: { description: errorText(e.reason) } },
    });
  });

  // ── Evaluation ─────────────────────────────────────────────────────────

  function describe(value, byValue) {
    if (value === undefined) return { type: 'undefined' };
    if (value === null) return { type: 'object', subtype: 'null', value: null };
    var type = typeof value;
    if (byValue) {
      var text = JSON.stringify(value);
      return text === undefined ? { type: 'undefined' } : { type: type, value: JSON.parse(text) };
    }
    if (type === 'number' && !isFinite(value)) return { type: type, unserializableValue: String(value) };
    if (type !== 'object' && type !== 'function') return { type: type, value: type === 'bigint' ? String(value) : value };
    var id = 'o' + nextObject++;
    objects[id] = value;
    return { type: type, objectId: id, description: Object.prototype.toString.call(value) };
  }

  function mouseTarget(x, y) {
    return document.elementFromPoint(x, y) || document.body;
  }

  function fire(target, type, Ctor, x, y, bubbles) {
    target.dispatchEvent(new Ctor(type, {
      bubbles: bubbles, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true,
    }));
  }

  window.__emeraldBridge = {
    started: function (id) {
      return !!started[id];
    },

    probe: function (on) {
      probing = on;
    },

    run: function (id, options, body) {
      started[id] = true;
      var reply = function (outcome) {
        delete started[id];
        invoke('devbridge_reply', { id: id, payload: JSON.stringify(outcome) });
      };
      Promise.resolve()
        .then(body)
        .then(function (value) {
          return { result: describe(value, options.returnByValue) };
        })
        .catch(function (e) {
          return { exceptionDetails: { text: 'Uncaught', exception: { description: errorText(e) } } };
        })
        .then(reply);
    },

    object: function (id) {
      if (!(id in objects)) throw new Error('the object is no longer available');
      return objects[id];
    },

    release: function () {
      objects = {};
    },

    layoutMetrics: function () {
      return {
        cssVisualViewport: {
          pageX: window.scrollX, pageY: window.scrollY,
          clientWidth: window.innerWidth, clientHeight: window.innerHeight,
        },
      };
    },

    // The webview takes no input from outside, so the pointer is events
    // dispatched at whatever lies under the point. `:hover` styles do not
    // follow; handlers do.
    mouseMoved: function (p) {
      var target = mouseTarget(p.x, p.y);
      if (target !== hovered) {
        if (hovered && hovered.isConnected) {
          fire(hovered, 'pointerout', PointerEvent, p.x, p.y, true);
          fire(hovered, 'mouseout', MouseEvent, p.x, p.y, true);
          fire(hovered, 'mouseleave', MouseEvent, p.x, p.y, false);
        }
        fire(target, 'pointerover', PointerEvent, p.x, p.y, true);
        fire(target, 'pointerenter', PointerEvent, p.x, p.y, false);
        fire(target, 'mouseover', MouseEvent, p.x, p.y, true);
        fire(target, 'mouseenter', MouseEvent, p.x, p.y, false);
        hovered = target;
      }
      fire(target, 'pointermove', PointerEvent, p.x, p.y, true);
      fire(target, 'mousemove', MouseEvent, p.x, p.y, true);
      return {};
    },

    insertText: function (p) {
      document.execCommand('insertText', false, p.text);
      return {};
    },

    key: function (p) {
      var target = document.activeElement || document.body;
      var modifiers = p.modifiers || 0;
      var init = {
        key: p.key, code: p.code, bubbles: true, cancelable: true, composed: true, view: window,
        altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8),
      };
      if (p.type === 'keyUp') {
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        return {};
      }
      var event = new KeyboardEvent('keydown', init);
      // Read by handlers that predate `key`, and not settable through the constructor.
      var code = p.windowsVirtualKeyCode || 0;
      Object.defineProperty(event, 'keyCode', { get: function () { return code; } });
      Object.defineProperty(event, 'which', { get: function () { return code; } });
      if (!target.dispatchEvent(event)) return {};

      // A dispatched key event has no default action, so the editing a real
      // key press would do is done here.
      if (p.commands && p.commands.length) {
        p.commands.forEach(function (command) { document.execCommand(command); });
        return {};
      }
      var field = /^(INPUT|TEXTAREA)$/.test(target.tagName);
      if (!field && !target.isContentEditable) return {};
      if (p.key === 'Backspace') document.execCommand('delete');
      else if (p.key === 'Delete') document.execCommand('forwardDelete');
      else if (p.key === 'Enter') {
        if (target.isContentEditable) document.execCommand('insertParagraph');
        else if (target.tagName === 'TEXTAREA') document.execCommand('insertLineBreak');
      } else if (p.text) document.execCommand('insertText', false, p.text);
      return {};
    },
  };
})();
